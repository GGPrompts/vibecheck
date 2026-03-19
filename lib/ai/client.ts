import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider } from './providers/types';
import { createApiProvider, getRawClient, isApiKeyConfigured } from './providers/api';
import { createCliProvider } from './providers/cli';

// ── Provider management ──────────────────────────────────────────

let activeProviderName: 'api' | 'cli' | null = null;
let cachedProvider: AIProvider | null = null;

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
 *   2. Try CLI first (free for Max subscribers).
 *   3. Fall back to API if an API key is configured.
 *   4. Return API provider as ultimate default (will report unavailable).
 */
export async function getProvider(): Promise<AIProvider> {
  if (cachedProvider) return cachedProvider;

  if (activeProviderName === 'api') {
    cachedProvider = createApiProvider();
    return cachedProvider;
  }

  if (activeProviderName === 'cli') {
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
