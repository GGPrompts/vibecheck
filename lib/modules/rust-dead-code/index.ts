import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

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

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running cargo clippy for dead code detection...');

    let stdout = '';
    try {
      stdout = execSync('cargo clippy --message-format json -- -W dead_code 2>&1', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: '/bin/sh',
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

    opts.onProgress?.(60, 'Parsing dead code results...');

    const findings: Finding[] = [];
    let deadCodeCount = 0;

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

      // Only process dead_code warnings
      if (level !== 'warning') continue;
      if (!code?.code || !code.code.includes('dead_code')) continue;
      if (!spans || spans.length === 0) continue;

      deadCodeCount++;

      const span = spans[0];
      const message = `Dead code: ${msgText}`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'medium',
        filePath: span.file_name,
        line: span.line_start,
        message,
        category: 'dead-code',
        suggestion: 'Remove unused code or prefix with underscore to suppress the warning.',
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('rust-dead-code', finding),
      });
    }

    const score = Math.max(0, 100 - 5 * deadCodeCount);

    const metrics: Record<string, number> = {
      total: findings.length,
      deadCodeItems: deadCodeCount,
    };

    opts.onProgress?.(100, 'Rust dead code scan complete.');

    const summary =
      deadCodeCount === 0
        ? 'No dead code detected in Rust project.'
        : `Found ${deadCodeCount} dead code items.`;

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
    id: 'rust-dead-code',
    name: 'Rust Dead Code',
    description: 'Dead code detection via cargo clippy dead_code lint',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
