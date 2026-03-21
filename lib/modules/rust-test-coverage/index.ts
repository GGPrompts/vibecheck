import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

interface LlvmCovData {
  data?: Array<{
    totals?: {
      lines?: { percent: number; count: number; covered: number };
      functions?: { percent: number; count: number; covered: number };
      regions?: { percent: number; count: number; covered: number };
    };
  }>;
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running cargo test...');

    // Step 1: Run cargo test and parse results
    let testOutput = '';
    try {
      testOutput = execSync('cargo test 2>&1', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/sh',
      });
    } catch (error: unknown) {
      // cargo test exits non-zero when tests fail
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        testOutput = (error as { stdout: string }).stdout;
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
          return {
            score: -1,
            confidence: 0,
            findings: [],
            metrics: {},
            summary: 'cargo is not available. Ensure Rust toolchain is installed.',
          };
        }
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `cargo test failed: ${msg}`,
        };
      }
    }

    opts.onProgress?.(50, 'Parsing test results...');

    // Parse test result line: "test result: ok. X passed; Y failed; Z ignored"
    const resultMatch = testOutput.match(
      /test result: (\w+)\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/
    );

    let passed = 0;
    let failed = 0;
    let ignored = 0;
    let hasTests = false;

    if (resultMatch) {
      hasTests = true;
      passed = parseInt(resultMatch[2], 10);
      failed = parseInt(resultMatch[3], 10);
      ignored = parseInt(resultMatch[4], 10);
    } else {
      // Check for "running 0 tests" which means no tests exist
      const runningMatch = testOutput.match(/running (\d+) tests?/);
      if (runningMatch) {
        const runningCount = parseInt(runningMatch[1], 10);
        hasTests = runningCount > 0;
      }
    }

    const findings: Finding[] = [];

    if (!hasTests) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'high',
        filePath: 'Cargo.toml',
        message: 'No tests found in Rust project.',
        category: 'missing-tests',
        suggestion: 'Add unit tests using #[test] attribute or integration tests in the tests/ directory.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('rust-test-coverage', finding),
      });
    }

    if (failed > 0) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'high',
        filePath: 'Cargo.toml',
        message: `${failed} test(s) failing.`,
        category: 'failing-tests',
        suggestion: 'Fix failing tests to maintain code reliability.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('rust-test-coverage', finding),
      });
    }

    // Step 2: Try cargo-llvm-cov for actual coverage percentage
    opts.onProgress?.(70, 'Checking for coverage tool...');

    let coveragePercent: number | null = null;

    try {
      const covOutput = execSync('cargo llvm-cov --json 2>&1', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/sh',
      });

      try {
        const covData: LlvmCovData = JSON.parse(covOutput);
        const totals = covData.data?.[0]?.totals;
        if (totals?.lines?.percent !== undefined) {
          coveragePercent = totals.lines.percent;
        }
      } catch {
        // JSON parsing failed, coverage data not usable
      }
    } catch {
      // cargo-llvm-cov not installed or failed, that's fine
    }

    // Compute score
    let score: number;
    if (coveragePercent !== null) {
      score = Math.round(coveragePercent);
    } else if (!hasTests) {
      score = 0;
    } else if (failed > 0) {
      score = 50;
    } else {
      score = 100;
    }

    score = Math.max(0, Math.min(100, score));

    const metrics: Record<string, number> = {
      passed,
      failed,
      ignored,
      total: passed + failed,
      ...(coveragePercent !== null ? { coveragePercent } : {}),
    };

    opts.onProgress?.(100, 'Rust test coverage scan complete.');

    let summary: string;
    if (coveragePercent !== null) {
      summary = `${passed} tests passed, ${failed} failed. Line coverage: ${coveragePercent.toFixed(1)}%.`;
    } else if (!hasTests) {
      summary = 'No tests found in Rust project.';
    } else if (failed > 0) {
      summary = `${passed} tests passed, ${failed} failed.`;
    } else {
      summary = `All ${passed} tests passed.`;
    }

    return {
      score,
      confidence: coveragePercent !== null ? 1.0 : 0.7,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'rust-test-coverage',
    name: 'Rust Test Coverage',
    description: 'Test execution and optional coverage via cargo-llvm-cov',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
