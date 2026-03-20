/**
 * Centralized pricing constants and cost estimation for Claude models.
 * Prices are per million tokens (USD).
 */

interface ModelPricing {
  input: number;
  output: number;
}

const CLAUDE_PRICING: Record<string, ModelPricing> = {
  haiku: { input: 0.25, output: 1.25 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
};

export interface CostEstimate {
  haiku: number;
  sonnet: number;
  opus: number;
}

/**
 * Estimate the cost of running a prompt through each Claude model tier.
 * Assumes the prompt represents input tokens, and estimates output as 2x input
 * (a typical response-to-prompt ratio).
 *
 * @param tokenCount — estimated number of input tokens in the prompt
 * @returns cost in USD for each model tier
 */
export function estimatePromptCost(tokenCount: number): CostEstimate {
  const outputTokens = tokenCount * 2;

  const estimate = (pricing: ModelPricing): number => {
    return (
      (tokenCount / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output
    );
  };

  return {
    haiku: estimate(CLAUDE_PRICING.haiku),
    sonnet: estimate(CLAUDE_PRICING.sonnet),
    opus: estimate(CLAUDE_PRICING.opus),
  };
}

/**
 * Format a USD cost for display.
 * Returns "$0.04" for values >= $0.01, or "<$0.01" for smaller amounts.
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) {
    return '<$0.01';
  }
  return `$${usd.toFixed(2)}`;
}
