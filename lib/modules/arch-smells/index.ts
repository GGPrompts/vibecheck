import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { getProvider } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import { selectFilesForAnalysis } from '@/lib/ai/sampling';
import {
  ARCH_SMELLS_SYSTEM,
  buildArchSmellsPrompt,
} from '@/lib/ai/prompts/arch-smells';
import type { ArchSmellsInput } from '@/lib/ai/prompts/arch-smells';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'arch-smells';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', 'out', '.git',
  'coverage', '.turbo', '.vercel', '__pycache__', '.cache',
]);

/**
 * Build a project structure listing for context.
 */
function getProjectStructure(repoPath: string): string[] {
  const structure: string[] = [];

  try {
    const entries = readdirSync(repoPath, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (EXCLUDE_DIRS.has(entry.name)) continue;

      if (entry.isDirectory()) {
        structure.push(`${entry.name}/`);
        try {
          const subEntries = readdirSync(join(repoPath, entry.name), {
            withFileTypes: true,
            encoding: 'utf-8',
          }) as import('fs').Dirent[];
          for (const sub of subEntries) {
            if (sub.name.startsWith('.')) continue;
            if (EXCLUDE_DIRS.has(sub.name)) continue;
            const suffix = sub.isDirectory() ? '/' : '';
            structure.push(`  ${entry.name}/${sub.name}${suffix}`);
          }
        } catch {
          // Can't read subdirectory
        }
      } else if (entry.isFile()) {
        structure.push(entry.name);
      }
    }
  } catch {
    // Can't read repo root
  }

  return structure;
}

/**
 * Extract import statements from file content.
 */
function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1] ?? match[2]);
  }
  return imports;
}

/**
 * Extract export names from file content.
 */
function extractExports(content: string): string[] {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  // Also catch "export { ... }"
  const reExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim());
    exports.push(...names.filter(Boolean));
  }
  return exports;
}

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    const provider = await getProvider();
    return provider.isAvailable();
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    const provider = await getProvider();
    if (!(await provider.isAvailable())) {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'AI not available',
      };
    }

    const tracker = createTokenTracker(25_000);

    opts.onProgress?.(5, 'Selecting files for architecture analysis...');

    const sampledFiles = await selectFilesForAnalysis(repoPath, [], 15);

    if (sampledFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { filesAnalyzed: 0 },
        summary: 'No source files found for architecture analysis.',
      };
    }

    opts.onProgress?.(15, `Analyzing architecture in ${sampledFiles.length} files...`);

    const projectStructure = getProjectStructure(repoPath);
    const allFindings: Finding[] = [];

    // Batch files in groups of 5
    const batchSize = 5;
    for (let i = 0; i < sampledFiles.length; i += batchSize) {
      if (opts.signal?.aborted) break;
      if (tracker.isExhausted()) break;

      const batch = sampledFiles.slice(i, i + batchSize);
      const fileInputs: ArchSmellsInput['files'] = [];

      for (const sampled of batch) {
        const fullPath = join(repoPath, sampled.filePath);
        let content: string;
        try {
          content = readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }
        const lineCount = content.split('\n').length;
        const imports = extractImports(content);
        const exports = extractExports(content);

        fileInputs.push({
          filePath: sampled.filePath,
          lineCount,
          exports,
          imports,
          content,
        });
      }

      if (fileInputs.length === 0) continue;

      const input: ArchSmellsInput = {
        files: fileInputs,
        projectStructure,
      };

      const userPrompt = buildArchSmellsPrompt(input);

      try {
        const response = await provider.query(userPrompt, {
          model: getModelForModule(MODULE_ID),
          maxTokens: 4096,
          system: ARCH_SMELLS_SYSTEM,
        });

        if (provider.tracksCost && response.inputTokens != null && response.outputTokens != null) {
          tracker.track(response.inputTokens, response.outputTokens);
        }

        const text = response.text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch
          ? JSON.parse(jsonMatch[0])
          : { findings: [] };

        if (Array.isArray(parsed.findings)) {
          for (const f of parsed.findings) {
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: f.severity ?? 'medium',
              filePath: f.filePath ?? '',
              line: f.line ?? undefined,
              message: f.message ?? 'Architecture smell',
              category: 'arch-smell',
              suggestion: f.suggestion ?? undefined,
            };
            allFindings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('abort')) {
          break;
        }
        // Swallow other API errors and continue with next batch
      }

      const progress = 15 + Math.round(((i + batchSize) / sampledFiles.length) * 75);
      opts.onProgress?.(Math.min(progress, 90), `Processed ${Math.min(i + batchSize, sampledFiles.length)} of ${sampledFiles.length} files...`);
    }

    opts.onProgress?.(95, 'Computing architecture score...');

    // Scoring: 100 - deductions per finding
    let score = 100;
    for (const f of allFindings) {
      score -= SEVERITY_DEDUCTIONS[f.severity] ?? 2;
    }
    score = Math.max(0, score);

    const usage = tracker.getUsage();

    const metrics: Record<string, number> = {
      filesAnalyzed: sampledFiles.length,
      findingsCount: allFindings.length,
      tokensUsed: usage.totalTokens,
    };

    const summary = allFindings.length > 0
      ? `Found ${allFindings.length} architecture smells across ${sampledFiles.length} files. Score: ${score}/100.`
      : `No architecture smells found in ${sampledFiles.length} files analyzed.`;

    opts.onProgress?.(100, 'Architecture analysis complete.');

    return {
      score,
      confidence: 0.60,
      findings: allFindings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Architecture Smells',
    description: 'AI-powered detection of architectural anti-patterns and structural issues',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
