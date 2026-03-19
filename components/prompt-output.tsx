'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ClipboardCopy, Sparkles, Loader2, Check } from 'lucide-react';
import { estimateTokens } from '@/lib/prompt-generator/token-estimator';
import { estimatePromptCost, formatCost } from '@/lib/ai/pricing';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}K`;
  }
  return `~${tokens}`;
}

interface PromptOutputProps {
  scanId: string;
}

export function PromptOutput({ scanId }: PromptOutputProps) {
  const [prompt, setPrompt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const res = await fetch(`/api/scans/${scanId}/prompt`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Failed to generate prompt');
        return;
      }

      setPrompt(data.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!prompt) return;

    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = prompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const costEstimate = React.useMemo(() => {
    if (!prompt) return null;
    const tokens = estimateTokens(prompt);
    const costs = estimatePromptCost(tokens);
    return { tokens, costs };
  }, [prompt]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={handleGenerate} disabled={loading} variant="default">
          {loading ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : (
            <Sparkles className="size-4" data-icon="inline-start" />
          )}
          {loading ? 'Generating...' : 'Generate Claude Prompt'}
        </Button>

        {prompt && (
          <Button onClick={handleCopy} variant="outline" size="sm">
            {copied ? (
              <Check className="size-4" data-icon="inline-start" />
            ) : (
              <ClipboardCopy className="size-4" data-icon="inline-start" />
            )}
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {prompt && (
        <div className="relative rounded-lg border bg-muted/30 p-4">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
            {prompt}
          </pre>
        </div>
      )}

      {prompt && costEstimate && (
        <p className="text-xs text-muted-foreground">
          {formatTokenCount(costEstimate.tokens)} tokens{' '}
          &middot; Haiku {formatCost(costEstimate.costs.haiku)}{' '}
          &middot; Sonnet {formatCost(costEstimate.costs.sonnet)}{' '}
          &middot; Opus {formatCost(costEstimate.costs.opus)}
        </p>
      )}
    </div>
  );
}
