import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface ClippyMessage {
  reason: string;
  message?: {
    level: string;
    message: string;
    code?: { code: string } | null;
    spans?: Array<{
      file_name: string;
      line_start: number;
      line_end: number;
    }>;
    rendered?: string;
  };
}

function mapLevel(level: string): Severity {
  switch (level) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    default:
      return 'info';
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running cargo clippy...');

    let stdout = '';
    try {
      stdout = execSync('cargo clippy --message-format json -- -W clippy::all 2>&1', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/sh',
      });
    } catch (error: unknown) {
      // clippy exits non-zero when it finds issues
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        stdout = (error as { stdout: string }).stdout;
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
          return {
            score: -1,
            confidence: 0,
            findings: [],
            metrics: {},
            summary: 'cargo clippy is not available. Install the clippy component: rustup component add clippy',
          };
        }
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `cargo clippy failed: ${msg}`,
        };
      }
    }

    opts.onProgress?.(60, 'Parsing clippy results...');

    const findings: Finding[] = [];
    let warningCount = 0;
    let errorCount = 0;

    const lines = stdout.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      let parsed: ClippyMessage;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      if (parsed.reason !== 'compiler-message' || !parsed.message) continue;

      const { level, message: msgText, spans, code } = parsed.message;

      if (level !== 'warning' && level !== 'error') continue;

      // Skip summary messages like "X warnings generated"
      if (!spans || spans.length === 0) continue;

      if (level === 'warning') warningCount++;
      if (level === 'error') errorCount++;

      const span = spans[0];
      const severity = mapLevel(level);
      const codeStr = code?.code ? ` [${code.code}]` : '';
      const message = `${msgText}${codeStr}`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath: span.file_name,
        line: span.line_start,
        message,
        category: 'clippy-lint',
        suggestion: parsed.message.rendered
          ? parsed.message.rendered.split('\n').slice(1).join('\n').trim() || undefined
          : undefined,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('rust-complexity', finding),
      });
    }

    const score = Math.max(0, 100 - 3 * warningCount - 10 * errorCount);

    const metrics: Record<string, number> = {
      total: findings.length,
      warnings: warningCount,
      errors: errorCount,
    };

    opts.onProgress?.(100, 'Rust complexity scan complete.');

    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} errors`);
    if (warningCount > 0) parts.push(`${warningCount} warnings`);

    const summary =
      findings.length === 0
        ? 'No clippy warnings or errors found.'
        : `Found ${parts.join(' and ')} from clippy analysis.`;

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
    id: 'rust-complexity',
    name: 'Rust Complexity',
    description: 'Code quality and lint analysis via cargo clippy',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
