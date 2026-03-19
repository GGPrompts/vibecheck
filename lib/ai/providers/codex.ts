/**
 * Codex provider — spawns `codex` as a child process.
 *
 * Used for cross-model AI audits. Does not track tokens or cost.
 * The `codex` CLI accepts a prompt via the `-q` (quiet) flag and
 * writes the response to stdout as plain text.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AIProvider, AIResponse, AIQueryOptions } from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;

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

      // Build the command arguments.
      // `codex -q` runs in quiet/non-interactive mode with the prompt as argument.
      const args = ['-q', prompt];

      // If a model is specified, pass it via --model flag
      if (opts?.model) {
        args.unshift('--model', opts.model);
      }

      try {
        const { stdout, stderr } = await execFileAsync('codex', args, {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          encoding: 'utf-8',
        });

        const text = stdout.trim();

        if (!text && stderr) {
          throw new Error(`codex CLI error: ${stderr.trim()}`);
        }

        return {
          text,
          // Codex provider does not report token usage
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
          // Non-zero exit code
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
