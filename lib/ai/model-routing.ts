import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CLAUDE_PRICING } from './pricing';

/**
 * Available model tiers.
 */
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

/**
 * Maps tier names to actual Claude model IDs.
 */
export const MODEL_IDS: Record<ModelTier, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

/**
 * Overrides structure for model selection.
 */
export interface ModelOverrides {
  global?: string;
  modules?: Record<string, string>;
}

/**
 * Maps module IDs to Claude model identifiers.
 *
 * Current strategy: all modules use claude-sonnet-4-6.
 * Opus is reserved for future high-fidelity analysis passes.
 */
const MODULE_MODEL_MAP: Record<string, string> = {
  'arch-smells': 'claude-sonnet-4-6',
  'naming-quality': 'claude-sonnet-4-6',
  'doc-staleness': 'claude-sonnet-4-6',
  'test-quality': 'claude-sonnet-4-6',
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Load model overrides from the ~/.vibecheck/.env file.
 */
export function loadModelOverrides(): ModelOverrides | undefined {
  try {
    const envPath = join(homedir(), '.vibecheck', '.env');
    if (!existsSync(envPath)) return undefined;
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eqIndex = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
      if (key === 'VIBECHECK_MODEL_OVERRIDES' && value) {
        return JSON.parse(value) as ModelOverrides;
      }
    }
  } catch {
    // Silently handle parse/read errors
  }
  return undefined;
}

/**
 * Returns the Claude model ID to use for a given module.
 *
 * Resolution order:
 *   1. overrides.modules[moduleId] (per-module override)
 *   2. overrides.global (global override)
 *   3. Hardcoded default from MODULE_MODEL_MAP
 *
 * If no overrides are passed, they are loaded from ~/.vibecheck/.env.
 */
export function getModelForModule(
  moduleId: string,
  overrides?: ModelOverrides
): string {
  const resolved = overrides ?? loadModelOverrides();

  if (resolved) {
    // Check per-module override first
    const moduleTier = resolved.modules?.[moduleId];
    if (moduleTier && moduleTier in MODEL_IDS) {
      return MODEL_IDS[moduleTier as ModelTier];
    }

    // Check global override
    if (resolved.global && resolved.global in MODEL_IDS) {
      return MODEL_IDS[resolved.global as ModelTier];
    }
  }

  return MODULE_MODEL_MAP[moduleId] ?? DEFAULT_MODEL;
}

/**
 * Returns available model tiers with display names and pricing info for the settings UI.
 */
export function getAvailableTiers(): Array<{
  tier: ModelTier;
  name: string;
  inputCost: string;
  outputCost: string;
}> {
  return [
    {
      tier: 'haiku',
      name: 'Haiku',
      inputCost: `$${CLAUDE_PRICING.haiku.input.toFixed(2)}`,
      outputCost: `$${CLAUDE_PRICING.haiku.output.toFixed(2)}`,
    },
    {
      tier: 'sonnet',
      name: 'Sonnet',
      inputCost: `$${CLAUDE_PRICING.sonnet.input.toFixed(2)}`,
      outputCost: `$${CLAUDE_PRICING.sonnet.output.toFixed(2)}`,
    },
    {
      tier: 'opus',
      name: 'Opus',
      inputCost: `$${CLAUDE_PRICING.opus.input.toFixed(2)}`,
      outputCost: `$${CLAUDE_PRICING.opus.output.toFixed(2)}`,
    },
  ];
}

/**
 * Per-million-token pricing (USD) for cost estimation.
 * Updated to reflect current Anthropic pricing.
 */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-haiku-3-5': { input: 0.8, output: 4 },
};

/**
 * Estimate cost in USD for a given model and token counts.
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[modelId];
  if (!costs) return 0;
  return (
    (inputTokens / 1_000_000) * costs.input +
    (outputTokens / 1_000_000) * costs.output
  );
}
