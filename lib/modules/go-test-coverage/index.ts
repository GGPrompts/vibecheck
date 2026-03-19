import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

function hasTestFiles(repoPath: string): boolean {
  try {
    const result = execSync('find . -name "*_test.go" -type f | head -1', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'go.mod')) && hasTestFiles(repoPath);
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running Go tests with coverage...');

    const coverId = nanoid(8);
    const coverFile = `/tmp/vibecheck-cover-${coverId}.out`;

    let stdout = '';
    let stderr = '';
    try {
      const output = execSync(
        `go test -coverprofile=${coverFile} ./... 2>&1`,
        {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      stdout = output;
    } catch (error: unknown) {
      // go test exits non-zero if tests fail, but we may still get coverage data
      if (error && typeof error === 'object') {
        if (
          'stdout' in error &&
          typeof (error as { stdout: unknown }).stdout === 'string'
        ) {
          stdout = (error as { stdout: string }).stdout;
        }
        if (
          'stderr' in error &&
          typeof (error as { stderr: unknown }).stderr === 'string'
        ) {
          stderr = (error as { stderr: string }).stderr;
        }
      }

      // If we got no output at all, it's a real failure
      if (!stdout && !stderr) {
        cleanup(coverFile);
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `go test failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    opts.onProgress?.(70, 'Parsing coverage results...');

    const combined = `${stdout}\n${stderr}`;

    // Parse coverage from output lines like "coverage: 75.2% of statements"
    // or "ok  package  0.5s  coverage: 75.2% of statements"
    const coveragePattern = /coverage:\s+([\d.]+)%\s+of\s+statements/g;
    const coverages: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = coveragePattern.exec(combined)) !== null) {
      coverages.push(parseFloat(match[1]));
    }

    // Also check for packages with no test files: "[no test files]"
    const noTestPattern = /\[no test files\]/g;
    let noTestCount = 0;
    while (noTestPattern.exec(combined) !== null) {
      noTestCount++;
    }

    // Check for test failures
    const failPattern = /^---\s+FAIL:/gm;
    let failCount = 0;
    while (failPattern.exec(combined) !== null) {
      failCount++;
    }

    cleanup(coverFile);

    const findings: Finding[] = [];

    if (coverages.length === 0) {
      // No coverage data found
      return {
        score: 0,
        confidence: 0.5,
        findings: [],
        metrics: { packages: 0, noTestFiles: noTestCount, failedTests: failCount },
        summary: 'Could not extract coverage percentage from go test output.',
      };
    }

    // Average coverage across all packages that reported coverage
    const totalCoverage =
      coverages.reduce((sum, c) => sum + c, 0) / coverages.length;
    const score = Math.round(Math.min(100, Math.max(0, totalCoverage)));

    if (totalCoverage < 50) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'medium',
        filePath: 'go.mod',
        message: `Overall test coverage is ${totalCoverage.toFixed(1)}%, below 50% threshold.`,
        category: 'low-coverage',
        suggestion: 'Add tests to improve coverage, especially for critical paths.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('go-test-coverage', finding),
      });
    }

    if (noTestCount > 0) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'low',
        filePath: 'go.mod',
        message: `${noTestCount} packages have no test files.`,
        category: 'missing-tests',
        suggestion: 'Add _test.go files for untested packages.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('go-test-coverage', finding),
      });
    }

    if (failCount > 0) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'high',
        filePath: 'go.mod',
        message: `${failCount} test(s) are failing.`,
        category: 'test-failure',
        suggestion: 'Fix failing tests before deployment.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('go-test-coverage', finding),
      });
    }

    const metrics: Record<string, number> = {
      coveragePercent: Math.round(totalCoverage * 10) / 10,
      packagesWithCoverage: coverages.length,
      noTestFiles: noTestCount,
      failedTests: failCount,
    };

    opts.onProgress?.(100, 'Go test coverage analysis complete.');

    const summary = `Test coverage: ${totalCoverage.toFixed(1)}% across ${coverages.length} packages.${
      failCount > 0 ? ` ${failCount} test(s) failing.` : ''
    }${noTestCount > 0 ? ` ${noTestCount} packages have no tests.` : ''}`;

    return {
      score,
      confidence: 1.0,
      findings,
      metrics,
      summary,
    };
  },
};

function cleanup(coverFile: string): void {
  try {
    if (existsSync(coverFile)) {
      unlinkSync(coverFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}

registerModule(
  {
    id: 'go-test-coverage',
    name: 'Go Test Coverage',
    description: 'Test coverage analysis for Go projects',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
