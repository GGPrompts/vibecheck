/**
 * CLI provider — spawns `claude -p` as a child process.
 *
 * Free for Max subscribers. Does not track tokens or cost.
 * Pipes the prompt via stdin to handle large prompts (audit prompts
 * can include 15+ source files, easily exceeding OS arg limits).
 */

import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { AIProvider, AIResponse, AIQueryOptions } from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes — agentic audits need time to read files and reason

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

/**
 * Run claude CLI with prompt piped via stdin to avoid ARG_MAX limits.
 */
function runClaude(args: string[], prompt: string, timeoutMs: number, onChunk?: (chunk: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      onChunk?.(chunk);
    });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(Object.assign(new Error('timeout'), { killed: true }));
      } else if (code !== 0) {
        reject(Object.assign(new Error(`exited with code ${code}`), { code, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });

    // Pipe prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
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

      // Build command arguments. Prompt is piped via stdin, not passed as arg.
      const args = ['-p'];

      // Append to Claude's default system prompt rather than replacing it
      if (opts?.system) {
        args.push('--append-system-prompt', opts.system);
      }

      // Support model selection if provided
      if (opts?.model) {
        args.push('--model', opts.model);
      }

      try {
        const { stdout, stderr } = await runClaude(args, prompt, DEFAULT_TIMEOUT_MS, opts?.onChunk);

        const text = stdout.trim();

        if (!text && stderr) {
          throw new Error(`claude CLI error: ${stderr.trim()}`);
        }

        return {
          text,
          inputTokens: undefined,
          outputTokens: undefined,
          model: opts?.model ?? undefined,
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
