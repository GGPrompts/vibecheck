import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'go.mod'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Checking for dead code...');

    // Check if deadcode is available
    let deadcodeAvailable = false;
    try {
      execSync('which deadcode', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      deadcodeAvailable = true;
    } catch {
      // Not available
    }

    if (!deadcodeAvailable) {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary:
          'deadcode not installed. Install with: go install golang.org/x/tools/cmd/deadcode@latest',
      };
    }

    let stdout = '';
    try {
      stdout = execSync('deadcode ./...', {
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
          summary: `deadcode failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    opts.onProgress?.(50, 'Parsing dead code results...');

    // deadcode output format: "package.FuncName" or "path/to/file.go:line:col: funcName is unused"
    const findings: Finding[] = [];
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);

    // Common deadcode output pattern: file.go:line:col: message
    const locationPattern = /^(.+?):(\d+):(?:\d+:)?\s*(.+)$/;

    for (const line of lines) {
      const match = line.trim().match(locationPattern);

      let filePath: string;
      let lineNum: number | undefined;
      let message: string;

      if (match) {
        [, filePath, , message] = match;
        lineNum = parseInt(match[2], 10);
      } else {
        // Plain function name output
        filePath = 'unknown';
        message = `Unused function: ${line.trim()}`;
      }

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'low',
        filePath,
        line: lineNum,
        message,
        category: 'dead-code',
        suggestion: 'Remove unused function or export it if needed.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('go-dead-code', finding),
      });
    }

    const unusedCount = findings.length;
    const score = Math.max(0, 100 - 5 * unusedCount);

    const metrics: Record<string, number> = {
      total: unusedCount,
    };

    opts.onProgress?.(100, 'Go dead code analysis complete.');

    const summary =
      unusedCount === 0
        ? 'No dead code found.'
        : `Found ${unusedCount} unused functions.`;

    return {
      score,
      confidence: 0.8,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'go-dead-code',
    name: 'Go Dead Code',
    description: 'Unused function detection via deadcode',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
