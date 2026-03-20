/**
 * Codex provider — spawns `codex exec` as a child process.
 *
 * Used for cross-model AI audits (GPT-5.4 via Codex). Does not track tokens.
 * Uses `codex exec` in full-auto mode with stdin piping for the prompt.
 * Like the CLI provider, Codex has filesystem access and reads files itself.
 */

import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AIProvider, AIResponse, AIQueryOptions } from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes — codex can be slower

/**
 * Check whether the `codex` binary exists on PATH.
 */
async function codexBinaryExists(): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', 'codex'], {
      shell: true,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run codex exec with prompt piped via stdin.
 */
function runCodex(args: string[], prompt: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(Object.assign(new Error('timeout'), { killed: true }));
      } else if (code !== 0 && code !== null) {
        reject(Object.assign(new Error(`exited with code ${code}`), { code, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });

    // Pipe prompt via stdin (codex exec reads from stdin when prompt is `-`)
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function createCodexProvider(): AIProvider {
  return {
    name: 'codex',
    tracksCost: false,

    async isAvailable(): Promise<boolean> {
      return codexBinaryExists();
    },

    async query(prompt: string, opts?: AIQueryOptions): Promise<AIResponse> {
      const available = await codexBinaryExists();
      if (!available) {
        throw new Error('codex CLI is not installed or not on PATH');
      }

      // Use `codex exec` in full-auto mode with stdin for the prompt
      const args = ['exec', '--full-auto', '-'];

      if (opts?.model) {
        args.push('--model', opts.model);
      }

      try {
        const { stdout, stderr } = await runCodex(args, prompt, DEFAULT_TIMEOUT_MS);

        const text = stdout.trim();

        if (!text && stderr) {
          throw new Error(`codex CLI error: ${stderr.trim()}`);
        }

        return {
          text,
          inputTokens: undefined,
          outputTokens: undefined,
          model: opts?.model ?? undefined,
        };
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'killed' in err && (err as { killed: boolean }).killed) {
          throw new Error(`codex CLI timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
        }

        if (err && typeof err === 'object' && 'code' in err) {
          const code = (err as { code: string | number }).code;
          if (code === 'ENOENT') {
            throw new Error('codex CLI is not installed or not on PATH');
          }
          const stderr = (err as { stderr?: string }).stderr ?? '';
          throw new Error(
            `codex CLI exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`
          );
        }

        throw err;
      }
    },
  };
}
