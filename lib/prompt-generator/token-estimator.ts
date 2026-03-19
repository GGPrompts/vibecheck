import { estimatePromptCost, type CostEstimate } from '@/lib/ai/pricing';

/**
 * Fast token count approximation.
 * Uses chars/4 which is a reasonable heuristic for English text
 * without requiring a tokenizer library.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface PromptDetails {
  tokens: number;
  costs: CostEstimate;
}

/**
 * Estimate token count and per-model costs for a given prompt string.
 */
export function estimatePromptDetails(prompt: string): PromptDetails {
  const tokens = estimateTokens(prompt);
  const costs = estimatePromptCost(tokens);
  return { tokens, costs };
}
