import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { execSync } from 'child_process';
import { getProvider } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import {
  CONTEXT_CONFLICTS_SYSTEM,
  buildContextConflictsPrompt,
} from '@/lib/ai/prompts/context-conflicts';
import type { ContextConflictsInput } from '@/lib/ai/prompts/context-conflicts';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'context-conflicts';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 8,
  high: 8,
  medium: 4,
  low: 2,
  info: 0,
};

/**
 * Glob patterns for context/instruction files that AI agents and developers
 * rely on for project guidance.
 */
const CONTEXT_FILE_GLOBS = [
  '{README,CLAUDE,AGENTS,PLAN,CONTRIBUTING}*.md',
  '.cursorrules',
  '.clinerules',
  'docs/**/*.md',
];

/**
 * Additional key files that are worth cross-referencing against documentation.
 */
const KEY_CONFIG_FILES = [
  'package.json',
  '.env.example',
  '.env.sample',
  'tsconfig.json',
];

const LANGUAGE_MAP: Record<string, string> = {
  '.md': 'markdown',
  '.json': 'json',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '': 'text', // files without extension like .cursorrules
};

/**
 * Use git ls-files + glob to find context files in the repo.
 */
function findContextFiles(repoPath: string): string[] {
  const found = new Set<string>();

  // Use git ls-files with glob patterns for tracked files
  for (const pattern of CONTEXT_FILE_GLOBS) {
    try {
      const output = execSync(
        `git ls-files "${pattern}" 2>/dev/null || true`,
        { cwd: repoPath, encoding: 'utf-8', timeout: 30_000, maxBuffer: 1024 * 1024 }
      );
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) found.add(trimmed);
      }
    } catch {
      // git not available or pattern matched nothing — continue
    }
  }

  // Also check for untracked context files at root level (common case)
  for (const pattern of CONTEXT_FILE_GLOBS) {
    // Only check simple root-level patterns (not globs with **)
    if (!pattern.includes('**') && !pattern.includes('/')) {
      try {
        const output = execSync(
          `ls -1 ${pattern} 2>/dev/null || true`,
          { cwd: repoPath, encoding: 'utf-8', timeout: 30_000, maxBuffer: 1024 * 1024 }
        );
        for (const line of output.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) found.add(trimmed);
        }
      } catch {
        // continue
      }
    }
  }

  // Add key config files if they exist
  for (const configFile of KEY_CONFIG_FILES) {
    if (existsSync(join(repoPath, configFile))) {
      found.add(configFile);
    }
  }

  // Also pick up a small sample of entry-point source files for cross-referencing
  const entryPointPatterns = [
    'src/index.ts',
    'src/main.ts',
    'index.ts',
    'main.ts',
    'app/layout.tsx',
    'app/page.tsx',
    'lib/index.ts',
    'bin/*.ts',
    'bin/*.mjs',
  ];
  for (const pattern of entryPointPatterns) {
    if (pattern.includes('*')) {
      try {
        const output = execSync(
          `git ls-files "${pattern}" 2>/dev/null | head -3 || true`,
          { cwd: repoPath, encoding: 'utf-8', timeout: 30_000, maxBuffer: 1024 * 1024 }
        );
        for (const line of output.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) found.add(trimmed);
        }
      } catch {
        // continue
      }
    } else if (existsSync(join(repoPath, pattern))) {
      found.add(pattern);
    }
  }

  return Array.from(found);
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

    const tracker = createTokenTracker(40_000);

    opts.onProgress?.(5, 'Discovering context and documentation files...');

    const contextFiles = findContextFiles(repoPath);

    if (contextFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { filesAnalyzed: 0 },
        summary: 'No context or documentation files found.',
      };
    }

    opts.onProgress?.(15, `Found ${contextFiles.length} context files, analyzing for conflicts...`);

    // Read all files and build inputs
    const inputs: ContextConflictsInput[] = [];
    for (const filePath of contextFiles) {
      const fullPath = join(repoPath, filePath);
      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }
      const ext = extname(filePath);
      inputs.push({
        filePath,
        content,
        language: LANGUAGE_MAP[ext] ?? 'text',
      });
    }

    if (inputs.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { filesAnalyzed: 0 },
        summary: 'Could not read any context files.',
      };
    }

    // Send ALL context files together in one batch so the AI can cross-reference
    const allFindings: Finding[] = [];

    if (!opts.signal?.aborted && !tracker.isExhausted()) {
      const userPrompt = buildContextConflictsPrompt(inputs);

      try {
        const response = await provider.query(userPrompt, {
          model: getModelForModule(MODULE_ID),
          maxTokens: 4096,
          system: CONTEXT_CONFLICTS_SYSTEM,
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
              message: f.message ?? 'Context conflict',
              category: 'context-conflict',
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
        if (
          err instanceof Error &&
          err.message.includes('abort')
        ) {
          // Aborted — return partial results below
        }
        // Otherwise swallow API error
      }
    }

    opts.onProgress?.(90, 'Computing context conflict score...');

    // Scoring: start at 100, deduct per finding
    let score = 100;
    for (const f of allFindings) {
      score -= SEVERITY_DEDUCTIONS[f.severity] ?? 2;
    }
    score = Math.max(0, score);

    const usage = tracker.getUsage();

    const metrics: Record<string, number> = {
      filesAnalyzed: inputs.length,
      findingsCount: allFindings.length,
      tokensUsed: usage.totalTokens,
    };

    const summary = allFindings.length > 0
      ? `Found ${allFindings.length} context conflicts across ${inputs.length} documentation/config files. Score: ${score}/100.`
      : `No context conflicts found across ${inputs.length} documentation/config files.`;

    opts.onProgress?.(100, 'Context conflicts analysis complete.');

    return {
      score,
      confidence: 0.7,
      findings: allFindings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Context Conflicts',
    description: 'AI-powered detection of contradictions and stale references across documentation and context files',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
