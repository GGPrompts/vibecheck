'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ClipboardCopy, Sparkles, Loader2, Check, ListTodo } from 'lucide-react';
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
  defaultView?: 'prompt' | 'actions';
}

interface NextActionBundle {
  file_path: string;
  summary: string;
  rationale: string;
  details: string[];
  suggested_actions: string[];
  suggested_commands: string[];
  modules: string[];
  severities: string[];
  task_type: 'deterministic' | 'exploratory';
  finding_ids: string[];
}

export function PromptOutput({ scanId, defaultView = 'actions' }: PromptOutputProps) {
  const [prompt, setPrompt] = React.useState<string | null>(null);
  const [actions, setActions] = React.useState<NextActionBundle[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [view, setView] = React.useState<'prompt' | 'actions'>(defaultView);

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
      setActions(Array.isArray(data.actions) ? data.actions : []);
      setView(defaultView);
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
          <>
            <Button onClick={() => setView('actions')} variant={view === 'actions' ? 'secondary' : 'outline'} size="sm">
              <ListTodo className="size-4" data-icon="inline-start" />
              Next Actions
            </Button>
            <Button onClick={() => setView('prompt')} variant={view === 'prompt' ? 'secondary' : 'outline'} size="sm">
              <Sparkles className="size-4" data-icon="inline-start" />
              Prompt
            </Button>
            <Button onClick={handleCopy} variant="outline" size="sm">
              {copied ? (
                <Check className="size-4" data-icon="inline-start" />
              ) : (
                <ClipboardCopy className="size-4" data-icon="inline-start" />
              )}
              {copied ? 'Copied!' : 'Copy Prompt'}
            </Button>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {prompt && view === 'prompt' && (
        <div className="relative rounded-lg border bg-muted/30 p-4">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-foreground">
            {prompt}
          </pre>
        </div>
      )}

      {actions.length > 0 && view === 'actions' && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Suggested Next Actions
          </h3>
          <div className="space-y-3">
            {actions.map((action, index) => (
              <div key={`${action.file_path}-${index}`} className="rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{action.summary}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {action.task_type}
                  </span>
                  {action.modules.map((moduleId) => (
                    <span key={moduleId} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {moduleId}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{action.file_path}</p>
                <p className="mt-2 text-sm">{action.rationale}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {action.suggested_actions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {action.suggested_commands.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {action.suggested_commands.map((command) => (
                      <code key={command} className="rounded bg-muted px-2 py-1 text-xs">
                        {command}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
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
