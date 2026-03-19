import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let client: Anthropic | null = null;
let keyChecked = false;
let apiKey: string | undefined;

/**
 * Resolve the API key from environment or ~/.vibecheck/.env file.
 */
function resolveApiKey(): string | undefined {
  // Prefer process.env
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // Fall back to ~/.vibecheck/.env
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
    // File doesn't exist or isn't readable — that's fine
  }

  return undefined;
}

/**
 * Returns true if an Anthropic API key is configured and available.
 */
export function isAiAvailable(): boolean {
  if (!keyChecked) {
    apiKey = resolveApiKey();
    keyChecked = true;
  }
  return apiKey !== undefined && apiKey.length > 0;
}

/**
 * Get the singleton Anthropic client.
 * Returns null if no API key is configured (never crashes).
 */
export function getClient(): Anthropic | null {
  if (client) return client;

  if (!isAiAvailable()) {
    return null;
  }

  client = new Anthropic({ apiKey: apiKey! });
  return client;
}
