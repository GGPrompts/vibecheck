import type { AIProvider } from './providers/types';
import { createApiProvider } from './providers/api';
import { createCliProvider } from './providers/cli';
import { createCodexProvider } from './providers/codex';

// ── Provider management ──────────────────────────────────────────

let activeProviderName: 'api' | 'cli' | 'codex' | null = null;
let cachedProvider: AIProvider | null = null;

/**
 * Read the persisted provider preference from ~/.vibecheck/.env.
 */
function getPersistedProvider(): 'api' | 'cli' | 'codex' | null {
  if (activeProviderName) return activeProviderName;
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');
    const envPath = join(homedir(), '.vibecheck', '.env');
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^VIBECHECK_AI_PROVIDER=(.+)$/m);
    if (match && (match[1] === 'api' || match[1] === 'cli' || match[1] === 'codex')) {
      return match[1];
    }
  } catch {
    // No persisted preference
  }
  return null;
}

/**
 * Get the active AI provider.
 *
 * Resolution order:
 *   1. If persisted in VIBECHECK_AI_PROVIDER, use that.
 *   2. Try CLI first (free for Max subscribers).
 *   3. Fall back to API if an API key is configured.
 *   4. Return API provider as ultimate default (will report unavailable).
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

  if (preferred === 'codex') {
    cachedProvider = createCodexProvider();
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

