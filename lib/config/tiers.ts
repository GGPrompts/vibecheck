/**
 * Scan tier definitions.
 *
 * Each tier controls how thoroughly vibecheck scans: which models,
 * how many parallel agents, whether live testing runs, etc.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScanTier = 'pro' | 'max' | 'max-x20' | 'api';

export interface TierConfig {
  models: {
    default: string;
    verify?: string;
  };
  parallelism: number;
  coverage: 'sampled' | 'full';
  liveTesting: boolean;
  crossModel: boolean;
  description: string;
}

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

export const TIERS: Record<ScanTier, TierConfig> = {
  pro: {
    models: { default: 'claude-haiku-4-5-20251001' },
    parallelism: 1,
    coverage: 'sampled',
    liveTesting: false,
    crossModel: false,
    description: 'Haiku-only, sequential, sampled top 10 files',
  },
  max: {
    models: { default: 'claude-sonnet-4-6' },
    parallelism: 4,
    coverage: 'full',
    liveTesting: false,
    crossModel: false,
    description: 'Sonnet, 4x parallel, full coverage',
  },
  'max-x20': {
    models: { default: 'claude-sonnet-4-6', verify: 'claude-opus-4-6' },
    parallelism: 8,
    coverage: 'full',
    liveTesting: true,
    crossModel: true,
    description: 'Sonnet + Opus verify, 8x parallel, live testing, cross-model with Codex',
  },
  api: {
    models: { default: 'claude-sonnet-4-6' },
    parallelism: 2,
    coverage: 'full',
    liveTesting: false,
    crossModel: false,
    description: 'User-selected model, configurable parallelism, token-budgeted',
  },
};

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

export function getTierConfig(tier: ScanTier): TierConfig {
  return TIERS[tier];
}
