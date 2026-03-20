/**
 * API provider — wraps the existing @anthropic-ai/sdk client.
 *
 * Tracks tokens and cost. Requires a configured Anthropic API key.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AIProvider, AIResponse, AIQueryOptions } from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Resolve the API key from environment or ~/.vibecheck/.env file.
 */
function resolveApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  try {
    const envPath = join(homedir(), '.vibecheck', '.env');
    const contents = readFileSync(envPath, 'utf-8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'ANTHROPIC_API_KEY' && value) {
        return value;
      }
    }
  } catch {
    // File doesn't exist or isn't readable
  }

  return undefined;
}

let cachedClient: Anthropic | null = null;
let cachedApiKey: string | undefined;

function getOrCreateClient(): Anthropic | null {
  if (cachedClient) return cachedClient;

  const apiKey = resolveApiKey();
  if (!apiKey) return null;

  cachedApiKey = apiKey;
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

export function createApiProvider(): AIProvider {
  return {
    name: 'api',
    tracksCost: true,

    async isAvailable(): Promise<boolean> {
      const key = resolveApiKey();
      return key !== undefined && key.length > 0;
    },

    async query(prompt: string, opts?: AIQueryOptions): Promise<AIResponse> {
      const client = getOrCreateClient();
      if (!client) {
        throw new Error('Anthropic API key is not configured');
      }

      const model = opts?.model ?? DEFAULT_MODEL;
      const maxTokens = opts?.maxTokens ?? DEFAULT_MAX_TOKENS;

      const params: Anthropic.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      };

      if (opts?.system) {
        params.system = opts.system;
      }

      // Use streaming when an onChunk callback is provided
      if (opts?.onChunk) {
        const stream = client.messages.stream(params);
        stream.on('text', (chunk) => {
          opts.onChunk!(chunk);
        });
        const response = await stream.finalMessage();

        const text =
          response.content.find((c) => c.type === 'text')?.text ?? '';

        return {
          text,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          model: response.model,
        };
      }

      const response = await client.messages.create(params);

      const text =
        response.content.find((c) => c.type === 'text')?.text ?? '';

      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
      };
    },
  };
}

/**
 * Expose the raw Anthropic client for backward compatibility.
 * Used by the legacy getClient() / isAiAvailable() surface in client.ts.
 */
export function getRawClient(): Anthropic | null {
  return getOrCreateClient();
}

export function isApiKeyConfigured(): boolean {
  const key = resolveApiKey();
  return key !== undefined && key.length > 0;
}
