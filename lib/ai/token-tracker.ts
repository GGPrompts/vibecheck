/**
 * Tracks token usage against a budget for AI analysis runs.
 */
export class TokenTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly budgetTokens: number;

  constructor(budgetTokens: number = 100_000) {
    this.budgetTokens = budgetTokens;
  }

  /**
   * Record token usage from a completed API call.
   */
  track(inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
  }

  /**
   * Check whether the remaining budget can accommodate the estimated token count.
   */
  canAfford(estimatedTokens: number): boolean {
    const totalUsed = this.inputTokens + this.outputTokens;
    return totalUsed + estimatedTokens <= this.budgetTokens;
  }

  /**
   * Get current usage snapshot.
   */
  getUsage(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    budgetRemaining: number;
  } {
    const totalTokens = this.inputTokens + this.outputTokens;
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens,
      budgetRemaining: Math.max(0, this.budgetTokens - totalTokens),
    };
  }

  /**
   * Returns true when the token budget has been fully consumed.
   */
  isExhausted(): boolean {
    return this.inputTokens + this.outputTokens >= this.budgetTokens;
  }
}

/**
 * Factory function for creating token trackers.
 */
export function createTokenTracker(budget?: number): TokenTracker {
  return new TokenTracker(budget);
}
