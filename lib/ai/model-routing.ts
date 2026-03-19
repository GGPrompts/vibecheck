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
 * Returns the Claude model ID to use for a given module.
 */
export function getModelForModule(moduleId: string): string {
  return MODULE_MODEL_MAP[moduleId] ?? DEFAULT_MODEL;
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
