import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

interface GoModule {
  Path?: string;
  Version?: string;
  Update?: {
    Path?: string;
    Version?: string;
  };
  Main?: boolean;
  Indirect?: boolean;
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'go.mod'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Checking Go dependency updates...');

    let stdout = '';
    try {
      stdout = execSync('go list -m -u -json all', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        stdout = (error as { stdout: string }).stdout;
      } else {
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `go list failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (!stdout.trim()) {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { total: 0, outdated: 0 },
        summary: 'No dependencies found.',
      };
    }

    opts.onProgress?.(50, 'Parsing dependency list...');

    // `go list -m -u -json all` outputs concatenated JSON objects (no array wrapper)
    const modules: GoModule[] = [];
    // Split by closing brace + newline + opening brace pattern
    const jsonText = `[${stdout.replace(/\}\s*\{/g, '},{')}]`;
    try {
      const parsed = JSON.parse(jsonText) as GoModule[];
      modules.push(...parsed);
    } catch {
      // Fallback: try parsing individual objects
      let depth = 0;
      let start = -1;
      for (let i = 0; i < stdout.length; i++) {
        if (stdout[i] === '{') {
          if (depth === 0) start = i;
          depth++;
        } else if (stdout[i] === '}') {
          depth--;
          if (depth === 0 && start >= 0) {
            try {
              modules.push(JSON.parse(stdout.slice(start, i + 1)));
            } catch {
              // Skip malformed entries
            }
            start = -1;
          }
        }
      }
    }

    const findings: Finding[] = [];
    let outdatedCount = 0;
    let totalDeps = 0;

    for (const mod of modules) {
      // Skip the main module itself
      if (mod.Main) continue;
      totalDeps++;

      if (mod.Update) {
        outdatedCount++;
        const current = mod.Version ?? 'unknown';
        const latest = mod.Update.Version ?? 'unknown';
        const message = `${mod.Path}: ${current} -> ${latest}`;

        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity: 'low',
          filePath: 'go.mod',
          message,
          category: 'outdated-dependency',
          suggestion: `Run \`go get ${mod.Path}@${latest}\` to update.`,
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('go-dependencies', finding),
        });
      }
    }

    const score = Math.max(0, 100 - 5 * outdatedCount);

    const metrics: Record<string, number> = {
      total: totalDeps,
      outdated: outdatedCount,
      upToDate: totalDeps - outdatedCount,
    };

    opts.onProgress?.(100, 'Go dependency check complete.');

    const summary =
      outdatedCount === 0
        ? `All ${totalDeps} dependencies are up to date.`
        : `${outdatedCount} of ${totalDeps} dependencies are outdated.`;

    return {
      score,
      confidence: 1.0,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'go-dependencies',
    name: 'Go Dependencies',
    description: 'Outdated dependency detection for Go modules',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
