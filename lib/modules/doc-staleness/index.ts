import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { nanoid } from 'nanoid';
import { getClient, isAiAvailable } from '@/lib/ai/client';
import { getModelForModule } from '@/lib/ai/model-routing';
import { createTokenTracker } from '@/lib/ai/token-tracker';
import {
  DOC_STALENESS_SYSTEM,
  buildDocStalenessPrompt,
} from '@/lib/ai/prompts/doc-staleness';
import type { DocStalenessInput } from '@/lib/ai/prompts/doc-staleness';
import { generateFingerprint } from '../fingerprint';
import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const MODULE_ID = 'doc-staleness';

const SEVERITY_DEDUCTIONS: Record<string, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

/**
 * Build a project structure listing: top-level files + first-level directories.
 */
function getProjectStructure(repoPath: string): string[] {
  const structure: string[] = [];
  const excludeDirs = new Set([
    'node_modules', '.next', 'dist', 'build', 'out', '.git',
    'coverage', '.turbo', '.vercel', '__pycache__', '.cache',
  ]);

  try {
    const entries = readdirSync(repoPath, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') continue;
      if (excludeDirs.has(entry.name)) continue;

      if (entry.isDirectory()) {
        structure.push(`${entry.name}/`);
        // List first-level children of this directory
        try {
          const subEntries = readdirSync(join(repoPath, entry.name), {
            withFileTypes: true,
            encoding: 'utf-8',
          }) as import('fs').Dirent[];
          for (const sub of subEntries) {
            if (sub.name.startsWith('.')) continue;
            if (excludeDirs.has(sub.name)) continue;
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
 * Collect exported symbols from source files as a rough "public API" list.
 */
function getPublicApis(repoPath: string): string[] {
  const apis: string[] = [];
  const srcDirs = ['lib', 'src', 'app'];

  for (const dir of srcDirs) {
    const dirPath = join(repoPath, dir);
    if (!existsSync(dirPath)) continue;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
      for (const entry of entries) {
        if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          apis.push(`${dir}/${entry.name}`);
        } else if (entry.isDirectory() && entry.name !== 'node_modules') {
          apis.push(`${dir}/${entry.name}/`);
        }
      }
    } catch {
      continue;
    }
  }

  return apis;
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    if (!isAiAvailable()) return false;
    return existsSync(join(repoPath, 'README.md'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    const client = getClient();
    if (!client) {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'AI not available',
      };
    }

    const tracker = createTokenTracker(25_000);

    opts.onProgress?.(10, 'Reading README and project structure...');

    let readmeContent: string;
    try {
      readmeContent = readFileSync(join(repoPath, 'README.md'), 'utf-8');
    } catch {
      return {
        score: 100,
        confidence: 0.3,
        findings: [],
        metrics: { filesAnalyzed: 0 },
        summary: 'Could not read README.md.',
      };
    }

    const projectStructure = getProjectStructure(repoPath);
    const publicApis = getPublicApis(repoPath);

    // Optionally read package.json
    let packageJson: string | undefined;
    try {
      packageJson = readFileSync(join(repoPath, 'package.json'), 'utf-8');
    } catch {
      // No package.json
    }

    opts.onProgress?.(30, 'Analyzing documentation staleness...');

    const input: DocStalenessInput = {
      readmeContent,
      projectStructure,
      publicApis,
      packageJson,
    };

    const userPrompt = buildDocStalenessPrompt(input);
    const findings: Finding[] = [];

    try {
      const response = await client.messages.create({
        model: getModelForModule(MODULE_ID),
        max_tokens: 4096,
        system: DOC_STALENESS_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }],
      });

      tracker.track(response.usage.input_tokens, response.usage.output_tokens);

      const text =
        response.content.find((c) => c.type === 'text')?.text ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch
        ? JSON.parse(jsonMatch[0])
        : { findings: [] };

      if (Array.isArray(parsed.findings)) {
        for (const f of parsed.findings) {
          const finding: Omit<Finding, 'id' | 'fingerprint'> = {
            severity: f.severity ?? 'medium',
            filePath: f.filePath ?? 'README.md',
            line: f.line ?? undefined,
            message: f.message ?? 'Documentation issue',
            category: 'doc-staleness',
            suggestion: f.suggestion ?? undefined,
          };
          findings.push({
            ...finding,
            id: nanoid(),
            fingerprint: generateFingerprint(MODULE_ID, finding),
          });
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('abort')) {
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: 'Analysis aborted.',
        };
      }
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: `AI analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }

    opts.onProgress?.(90, 'Computing doc staleness score...');

    // Scoring: 100 - (findings x severity weight)
    let score = 100;
    for (const f of findings) {
      score -= SEVERITY_DEDUCTIONS[f.severity] ?? 2;
    }
    score = Math.max(0, score);

    const usage = tracker.getUsage();

    const metrics: Record<string, number> = {
      filesAnalyzed: 1,
      findingsCount: findings.length,
      tokensUsed: usage.totalTokens,
    };

    const summary = findings.length > 0
      ? `Found ${findings.length} documentation issues. Score: ${score}/100.`
      : 'Documentation appears up-to-date with project structure.';

    opts.onProgress?.(100, 'Doc staleness analysis complete.');

    return {
      score,
      confidence: 0.65,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Doc Staleness',
    description: 'AI-powered detection of stale, missing, or misleading documentation',
    category: 'ai',
    defaultEnabled: false,
  },
  runner
);
