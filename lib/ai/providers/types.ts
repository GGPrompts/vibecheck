/**
 * Common types for the AI provider abstraction layer.
 *
 * Two providers are supported:
 *   - 'api'  — Anthropic SDK (pay-per-token)
 *   - 'cli'  — `claude -p` subprocess (free for Max subscribers)
 */

export interface AIResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface AIQueryOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
}

export interface AIProvider {
  name: 'api' | 'cli';
  /** Whether this provider returns token counts for cost tracking. */
  tracksCost: boolean;
  /** Returns true if the provider is ready to accept queries. */
  isAvailable(): Promise<boolean>;
  /** Send a prompt and get a response. */
  query(prompt: string, opts?: AIQueryOptions): Promise<AIResponse>;
}
