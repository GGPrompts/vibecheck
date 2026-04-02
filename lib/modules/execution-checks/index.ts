import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { Finding, ModuleResult, ModuleRunner, RunOptions, Severity } from '../types';

interface PackageJson {
  scripts?: Record<string, string>;
}

function readPackageJson(repoPath: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf-8')) as PackageJson;
  } catch {
    return null;
  }
}

function makeFinding(
  moduleId: string,
  severity: Severity,
  filePath: string,
  message: string,
  category: string,
  line?: number,
  suggestion?: string,
): Finding {
  const partial = { severity, filePath, line, message, category, suggestion };
  return {
    ...partial,
    id: nanoid(),
    fingerprint: generateFingerprint(moduleId, partial),
  };
}

function runCommand(command: string, repoPath: string) {
  try {
    const stdout = execSync(command, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '', exitCode: 0 };
  } catch (error: unknown) {
    if (error && typeof error === 'object') {
      const execError = error as {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        status?: number;
        message?: string;
      };
      const stdout =
        typeof execError.stdout === 'string'
          ? execError.stdout
          : Buffer.isBuffer(execError.stdout)
            ? execError.stdout.toString('utf-8')
            : '';
      const stderr =
        typeof execError.stderr === 'string'
          ? execError.stderr
          : Buffer.isBuffer(execError.stderr)
            ? execError.stderr.toString('utf-8')
            : execError.message ?? '';
      return {
        ok: false,
        stdout,
        stderr,
        exitCode: execError.status ?? 1,
      };
    }

    return { ok: false, stdout: '', stderr: String(error), exitCode: 1 };
  }
}

function parseTypecheckOutput(output: string): Finding[] {
  const findings: Finding[] = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/);
    if (!match) continue;
    findings.push(
      makeFinding(
        'typecheck',
        'high',
        match[1],
        `${match[4]}: ${match[5]}`,
        'typecheck',
        Number.parseInt(match[2], 10),
        'Fix the TypeScript error and rerun the typecheck.',
      ),
    );
  }
  return findings;
}

function parseLintOutput(output: string): Finding[] {
  try {
    const parsed = JSON.parse(output) as Array<{
      filePath: string;
      messages: Array<{
        line?: number;
        severity: number;
        message: string;
        ruleId?: string | null;
      }>;
    }>;

    const findings: Finding[] = [];
    for (const file of parsed) {
      for (const message of file.messages) {
        findings.push(
          makeFinding(
            'lint',
            message.severity === 2 ? 'medium' : 'low',
            file.filePath,
            message.ruleId ? `${message.message} (${message.ruleId})` : message.message,
            'lint',
            message.line,
            'Fix the lint violation and rerun the linter.',
          ),
        );
      }
    }
    return findings;
  } catch {
    return [];
  }
}

function parseGenericOutput(
  moduleId: string,
  output: string,
  category: string,
  suggestion: string,
): Finding[] {
  const findings: Finding[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const tsStyle = trimmed.match(/^(.+?):(\d+):(\d+):\s*(.+)$/);
    if (tsStyle) {
      findings.push(
        makeFinding(
          moduleId,
          'high',
          tsStyle[1],
          tsStyle[4],
          category,
          Number.parseInt(tsStyle[2], 10),
          suggestion,
        ),
      );
      continue;
    }
  }

  if (findings.length === 0 && output.trim()) {
    findings.push(
      makeFinding(
        moduleId,
        'high',
        moduleId === 'build' ? 'package.json' : '(command output)',
        output.trim().split('\n').slice(0, 8).join(' '),
        category,
        undefined,
        suggestion,
      ),
    );
  }

  return findings;
}

function buildResult(
  ok: boolean,
  findings: Finding[],
  metrics: Record<string, number>,
  successSummary: string,
  failureSummary: string,
): ModuleResult {
  return {
    score: ok ? 100 : 0,
    confidence: 1.0,
    findings,
    metrics,
    summary: ok ? successSummary : failureSummary,
  };
}

function createBuildRunner(): ModuleRunner {
  return {
    async canRun(repoPath: string) {
      const pkg = readPackageJson(repoPath);
      return !!pkg?.scripts?.build;
    },
    async run(repoPath: string, opts: RunOptions) {
      opts.onProgress?.(20, 'Running build command...');
      const result = runCommand('npm run build', repoPath);
      const output = `${result.stdout}\n${result.stderr}`.trim();
      const findings = result.ok
        ? []
        : parseGenericOutput(
            'build',
            output,
            'build',
            'Fix the build failure and rerun the build command.',
          );

      return buildResult(
        result.ok,
        findings,
        { exitCode: result.exitCode, errors: findings.length },
        'Build passed successfully.',
        `Build failed with ${findings.length || 1} diagnostic${findings.length === 1 ? '' : 's'}.`,
      );
    },
  };
}

function createLintRunner(): ModuleRunner {
  return {
    async canRun(repoPath: string) {
      const pkg = readPackageJson(repoPath);
      return !!pkg?.scripts?.lint;
    },
    async run(repoPath: string, opts: RunOptions) {
      opts.onProgress?.(20, 'Running lint command...');
      const result = runCommand('npm run lint -- --format json', repoPath);
      const findings = result.ok ? [] : parseLintOutput(result.stdout || result.stderr);
      const fallbackFindings =
        findings.length > 0
          ? findings
          : result.ok
            ? []
            : parseGenericOutput(
                'lint',
                `${result.stdout}\n${result.stderr}`.trim(),
                'lint',
                'Fix the lint errors and rerun the lint command.',
              );

      return buildResult(
        result.ok,
        fallbackFindings,
        { exitCode: result.exitCode, errors: fallbackFindings.length },
        'Lint passed successfully.',
        `Lint failed with ${fallbackFindings.length || 1} diagnostic${fallbackFindings.length === 1 ? '' : 's'}.`,
      );
    },
  };
}

function createTypecheckRunner(): ModuleRunner {
  return {
    async canRun(repoPath: string) {
      return existsSync(join(repoPath, 'tsconfig.json'));
    },
    async run(repoPath: string, opts: RunOptions) {
      opts.onProgress?.(20, 'Running TypeScript typecheck...');
      const result = runCommand('npx tsc --noEmit --pretty false', repoPath);
      const findings = result.ok
        ? []
        : parseTypecheckOutput(`${result.stdout}\n${result.stderr}`.trim());
      const fallbackFindings =
        findings.length > 0
          ? findings
          : result.ok
            ? []
            : parseGenericOutput(
                'typecheck',
                `${result.stdout}\n${result.stderr}`.trim(),
                'typecheck',
                'Fix the TypeScript errors and rerun the typecheck.',
              );

      return buildResult(
        result.ok,
        fallbackFindings,
        { exitCode: result.exitCode, errors: fallbackFindings.length },
        'Typecheck passed successfully.',
        `Typecheck failed with ${fallbackFindings.length || 1} diagnostic${fallbackFindings.length === 1 ? '' : 's'}.`,
      );
    },
  };
}

function createTestRunner(): ModuleRunner {
  return {
    async canRun(repoPath: string) {
      const pkg = readPackageJson(repoPath);
      const testScript = pkg?.scripts?.test;
      return !!testScript && !/no test/i.test(testScript);
    },
    async run(repoPath: string, opts: RunOptions) {
      opts.onProgress?.(20, 'Running test command...');
      const result = runCommand('npm test -- --runInBand', repoPath);
      const findings = result.ok
        ? []
        : parseGenericOutput(
            'test',
            `${result.stdout}\n${result.stderr}`.trim(),
            'test',
            'Fix the test failures and rerun the test command.',
          );

      return buildResult(
        result.ok,
        findings,
        { exitCode: result.exitCode, errors: findings.length },
        'Tests passed successfully.',
        `Tests failed with ${findings.length || 1} diagnostic${findings.length === 1 ? '' : 's'}.`,
      );
    },
  };
}

registerModule(
  {
    id: 'build',
    name: 'Build',
    description: 'Build command execution with captured diagnostics',
    category: 'static',
    defaultEnabled: true,
  },
  createBuildRunner(),
);

registerModule(
  {
    id: 'lint',
    name: 'Lint',
    description: 'Lint command execution with machine-usable diagnostics',
    category: 'static',
    defaultEnabled: true,
  },
  createLintRunner(),
);

registerModule(
  {
    id: 'typecheck',
    name: 'Typecheck',
    description: 'TypeScript typecheck execution with parsed compiler diagnostics',
    category: 'static',
    defaultEnabled: true,
  },
  createTypecheckRunner(),
);

registerModule(
  {
    id: 'test',
    name: 'Test',
    description: 'Test command execution with captured failure diagnostics',
    category: 'static',
    defaultEnabled: true,
  },
  createTestRunner(),
);
