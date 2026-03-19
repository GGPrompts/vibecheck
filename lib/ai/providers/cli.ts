/**
 * CLI provider — spawns `claude -p` as a child process.
 *
 * Free for Max subscribers. Does not track tokens or cost.
 * The `claude -p` command reads a prompt from its argument and writes
 * the response to stdout as plain text.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AIProvider, AIResponse, AIQueryOptions } from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Check whether the `claude` binary exists on PATH.
 */
async function claudeBinaryExists(): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', 'claude'], {
      shell: true,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function createCliProvider(): AIProvider {
  return {
    name: 'cli',
    tracksCost: false,

    async isAvailable(): Promise<boolean> {
      return claudeBinaryExists();
    },

    async query(prompt: string, opts?: AIQueryOptions): Promise<AIResponse> {
      const available = await claudeBinaryExists();
      if (!available) {
        throw new Error('claude CLI is not installed or not on PATH');
      }

      // Build the command arguments.
      // `claude -p` reads the prompt from the argument.
      // Note: claude -p does not support model selection — it uses whatever
      // the user's Max plan provides.
      const args = ['-p', prompt];

      // If a system prompt is provided, pass it via --system-prompt flag
      if (opts?.system) {
        args.push('--system-prompt', opts.system);
      }

      try {
        const { stdout, stderr } = await execFileAsync('claude', args, {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          encoding: 'utf-8',
        });

        const text = stdout.trim();

        if (!text && stderr) {
          throw new Error(`claude CLI error: ${stderr.trim()}`);
        }

        return {
          text,
          // CLI provider does not report token usage
          inputTokens: undefined,
          outputTokens: undefined,
          model: undefined,
        };
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'killed' in err && (err as { killed: boolean }).killed) {
          throw new Error(`claude CLI timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`);
        }

        if (err && typeof err === 'object' && 'code' in err) {
          const code = (err as { code: string | number }).code;
          if (code === 'ENOENT') {
            throw new Error('claude CLI is not installed or not on PATH');
          }
          // Non-zero exit code
          const stderr = (err as { stderr?: string }).stderr ?? '';
          throw new Error(
            `claude CLI exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`
          );
        }

        throw err;
      }
    },
  };
}
