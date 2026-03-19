import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface GolangCIIssue {
  FromLinter?: string;
  Text?: string;
  Severity?: string;
  SourceLines?: string[];
  Pos?: {
    Filename?: string;
    Line?: number;
    Column?: number;
  };
}

interface GolangCIOutput {
  Issues?: GolangCIIssue[];
}

function mapSeverity(sev?: string): Severity {
  switch (sev?.toLowerCase()) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'info':
    case 'suggestion':
      return 'low';
    default:
      return 'medium';
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'go.mod'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running Go linter...');

    // Try golangci-lint first
    let usedGolangciLint = false;
    let stdout = '';
    let stderr = '';

    try {
      execSync('which golangci-lint', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      usedGolangciLint = true;
    } catch {
      // golangci-lint not available, will fall back to go vet
    }

    if (usedGolangciLint) {
      try {
        stdout = execSync('golangci-lint run --out-format json', {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error: unknown) {
        // golangci-lint exits non-zero when issues are found
        if (
          error &&
          typeof error === 'object' &&
          'stdout' in error &&
          typeof (error as { stdout: unknown }).stdout === 'string'
        ) {
          stdout = (error as { stdout: string }).stdout;
        } else {
          // golangci-lint failed entirely, fall back to go vet
          usedGolangciLint = false;
        }
      }
    }

    if (usedGolangciLint && stdout.trim()) {
      opts.onProgress?.(50, 'Parsing golangci-lint results...');

      let parsed: GolangCIOutput;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: 'Failed to parse golangci-lint JSON output.',
        };
      }

      const issues = parsed.Issues ?? [];
      const findings: Finding[] = [];

      for (const issue of issues) {
        const severity = mapSeverity(issue.Severity);
        const filePath = issue.Pos?.Filename ?? 'unknown';
        const line = issue.Pos?.Line;
        const linter = issue.FromLinter ? ` [${issue.FromLinter}]` : '';
        const message = `${issue.Text ?? 'Lint issue'}${linter}`;

        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity,
          filePath,
          line,
          message,
          category: 'lint-issue',
          suggestion: `Review and fix the reported issue.`,
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('go-complexity', finding),
        });
      }

      const score = Math.max(0, 100 - 3 * findings.length);

      const metrics: Record<string, number> = {
        total: findings.length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
        low: findings.filter((f) => f.severity === 'low').length,
      };

      opts.onProgress?.(100, 'Go lint analysis complete.');

      const summary =
        findings.length === 0
          ? 'No lint issues found (golangci-lint).'
          : `Found ${findings.length} lint issues via golangci-lint.`;

      return {
        score,
        confidence: 1.0,
        findings,
        metrics,
        summary,
      };
    }

    // Fallback: go vet (always available with Go)
    opts.onProgress?.(30, 'Running go vet...');

    try {
      execSync('go vet ./...', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // go vet exits 0 with no output means no issues
      opts.onProgress?.(100, 'Go vet complete.');
      return {
        score: 100,
        confidence: 0.6,
        findings: [],
        metrics: { total: 0 },
        summary: 'No issues found (go vet). Install golangci-lint for deeper analysis.',
      };
    } catch (error: unknown) {
      // go vet exits non-zero and writes issues to stderr
      if (
        error &&
        typeof error === 'object' &&
        'stderr' in error &&
        typeof (error as { stderr: unknown }).stderr === 'string'
      ) {
        stderr = (error as { stderr: string }).stderr;
      } else {
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `go vet failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    opts.onProgress?.(70, 'Parsing go vet output...');

    // go vet output format: file.go:line:col: message
    const vetPattern = /^(.+?):(\d+):(?:\d+:)?\s*(.+)$/;
    const findings: Finding[] = [];

    for (const line of stderr.split('\n')) {
      const match = line.trim().match(vetPattern);
      if (!match) continue;

      const [, filePath, lineStr, message] = match;
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'medium',
        filePath,
        line: parseInt(lineStr, 10),
        message,
        category: 'vet-issue',
        suggestion: 'Review and fix the issue reported by go vet.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('go-complexity', finding),
      });
    }

    const score = Math.max(0, 100 - 3 * findings.length);

    const metrics: Record<string, number> = {
      total: findings.length,
    };

    opts.onProgress?.(100, 'Go vet analysis complete.');

    const summary =
      findings.length === 0
        ? 'No issues found (go vet). Install golangci-lint for deeper analysis.'
        : `Found ${findings.length} issues via go vet. Install golangci-lint for deeper analysis.`;

    return {
      score,
      confidence: 0.6,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'go-complexity',
    name: 'Go Complexity',
    description: 'Code quality and complexity analysis via golangci-lint or go vet',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
