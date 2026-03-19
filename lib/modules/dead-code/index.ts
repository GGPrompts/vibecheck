import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

interface KnipOutput {
  files?: string[];
  issues?: Array<{
    file: string;
    dependencies?: string[];
    devDependencies?: string[];
    unlisted?: string[];
    exports?: Array<{ name: string; line: number; col: number }>;
    types?: Array<{ name: string; line: number; col: number }>;
    duplicates?: Array<Array<{ name: string }>>;
  }>;
}

const MODULE_ID = 'dead-code';

function hasEntryPoint(repoPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf-8'));
    return !!(pkg.main || pkg.exports || pkg.module || pkg.source);
  } catch {
    return false;
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    if (!existsSync(join(repoPath, 'package.json'))) {
      return false;
    }
    return (
      existsSync(join(repoPath, 'tsconfig.json')) ||
      hasEntryPoint(repoPath)
    );
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running knip dead-code analysis...');

    let stdout = '';
    try {
      stdout = execSync('npx knip --reporter json', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      // knip exits non-zero when issues are found — still parse stdout
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
          summary: `knip analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (!stdout.trim()) {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { unusedFiles: 0, unusedExports: 0, unusedDependencies: 0 },
        summary: 'No dead code detected.',
      };
    }

    let knipData: KnipOutput;
    try {
      knipData = JSON.parse(stdout);
    } catch {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Failed to parse knip JSON output.',
      };
    }

    opts.onProgress?.(50, 'Parsing knip results...');

    const findings: Finding[] = [];
    let unusedFiles = 0;
    let unusedExports = 0;
    let unusedDeps = 0;

    // Unused files
    if (knipData.files) {
      for (const filePath of knipData.files) {
        unusedFiles++;
        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity: 'medium',
          filePath,
          message: `Unused file: ${filePath}`,
          category: 'dead-code',
          suggestion: 'Consider removing this file if it is no longer needed.',
        };
        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint(MODULE_ID, finding),
        });
      }
    }

    // Per-file issues
    if (knipData.issues) {
      for (const issue of knipData.issues) {
        // Unused exports
        if (issue.exports) {
          for (const exp of issue.exports) {
            unusedExports++;
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: 'low',
              filePath: issue.file,
              line: exp.line,
              message: `Unused export '${exp.name}' in ${issue.file}`,
              category: 'dead-code',
              suggestion: `Remove the unused export '${exp.name}' or verify it is needed.`,
            };
            findings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }

        // Unused types
        if (issue.types) {
          for (const typ of issue.types) {
            unusedExports++;
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: 'low',
              filePath: issue.file,
              line: typ.line,
              message: `Unused type export '${typ.name}' in ${issue.file}`,
              category: 'dead-code',
              suggestion: `Remove the unused type '${typ.name}' or verify it is needed.`,
            };
            findings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }

        // Unused dependencies
        if (issue.dependencies) {
          for (const dep of issue.dependencies) {
            unusedDeps++;
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: 'medium',
              filePath: 'package.json',
              message: `Unused dependency: ${dep}`,
              category: 'dead-dependency',
              suggestion: `Remove '${dep}' from dependencies with \`npm uninstall ${dep}\`.`,
            };
            findings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }

        // Unused devDependencies
        if (issue.devDependencies) {
          for (const dep of issue.devDependencies) {
            unusedDeps++;
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: 'medium',
              filePath: 'package.json',
              message: `Unused devDependency: ${dep}`,
              category: 'dead-dependency',
              suggestion: `Remove '${dep}' from devDependencies with \`npm uninstall -D ${dep}\`.`,
            };
            findings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }
      }
    }

    // Scoring: start at 100, deduct per category
    let score = 100;
    score -= unusedFiles * 3;
    score -= unusedExports * 1;
    score -= unusedDeps * 5;
    score = Math.max(0, score);

    const metrics: Record<string, number> = {
      unusedFiles,
      unusedExports,
      unusedDependencies: unusedDeps,
      total: findings.length,
    };

    opts.onProgress?.(100, 'Dead code analysis complete.');

    const parts: string[] = [];
    if (unusedFiles > 0) parts.push(`${unusedFiles} unused files`);
    if (unusedExports > 0) parts.push(`${unusedExports} unused exports`);
    if (unusedDeps > 0) parts.push(`${unusedDeps} unused dependencies`);

    const summary =
      findings.length === 0
        ? 'No dead code detected.'
        : `Found ${parts.join(', ')}.`;

    return {
      score,
      confidence: 0.9,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: MODULE_ID,
    name: 'Dead Code',
    description:
      'Unused files, exports, and dependencies detection via knip',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
