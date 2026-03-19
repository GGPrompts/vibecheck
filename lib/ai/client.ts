import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider } from './providers/types';
import { createApiProvider, getRawClient, isApiKeyConfigured } from './providers/api';
import { createCliProvider } from './providers/cli';

// ── Provider management ──────────────────────────────────────────

let activeProviderName: 'api' | 'cli' | null = null;
let cachedProvider: AIProvider | null = null;

/**
 * Read the persisted provider preference from ~/.vibecheck/.env.
 */
function getPersistedProvider(): 'api' | 'cli' | null {
  if (activeProviderName) return activeProviderName;
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');
    const envPath = join(homedir(), '.vibecheck', '.env');
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^VIBECHECK_AI_PROVIDER=(.+)$/m);
    if (match && (match[1] === 'api' || match[1] === 'cli')) {
      return match[1];
    }
  } catch {
    // No persisted preference
  }
  return null;
}

/**
 * Set the active AI provider by name.
 * Clears the cached provider instance so the next getProvider() call
 * creates the correct one.
 */
export function setProvider(name: 'api' | 'cli'): void {
  activeProviderName = name;
  cachedProvider = null;
}

/**
 * Get the active AI provider.
 *
 * Resolution order:
 *   1. If explicitly set via setProvider(), use that.
 *   2. If persisted in VIBECHECK_AI_PROVIDER, use that.
 *   3. Try CLI first (free for Max subscribers).
 *   4. Fall back to API if an API key is configured.
 *   5. Return API provider as ultimate default (will report unavailable).
 */
export async function getProvider(): Promise<AIProvider> {
  if (cachedProvider) return cachedProvider;

  const preferred = getPersistedProvider();

  if (preferred === 'api') {
    cachedProvider = createApiProvider();
    return cachedProvider;
  }

  if (preferred === 'cli') {
    cachedProvider = createCliProvider();
    return cachedProvider;
  }

  // Auto-detect: prefer CLI, fall back to API
  const cli = createCliProvider();
  if (await cli.isAvailable()) {
    cachedProvider = cli;
    return cachedProvider;
  }

  cachedProvider = createApiProvider();
  return cachedProvider;
}

/**
 * Synchronous helper that creates a provider without the availability check.
 * Useful when the caller will check availability itself.
 */
export function getProviderSync(): AIProvider {
  if (cachedProvider) return cachedProvider;

  if (activeProviderName === 'cli') {
    cachedProvider = createCliProvider();
    return cachedProvider;
  }

  if (activeProviderName === 'api') {
    cachedProvider = createApiProvider();
    return cachedProvider;
  }

  // Default to API for sync path (backward compat)
  cachedProvider = createApiProvider();
  return cachedProvider;
}

// ── Backward-compatible API ──────────────────────────────────────

/**
 * Returns true if an Anthropic API key is configured and available.
 * @deprecated Use `(await getProvider()).isAvailable()` instead.
 */
export function isAiAvailable(): boolean {
  return isApiKeyConfigured();
}

/**
 * Get the singleton Anthropic client.
 * Returns null if no API key is configured (never crashes).
 * @deprecated Use `getProvider()` instead.
 */
export function getClient(): Anthropic | null {
  return getRawClient();
}
