'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle, MinusCircle, Copy, Check, Terminal } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

interface ModuleScoreCardProps {
  repoId: string;
  moduleId: string;
  name: string;
  score: number;
  confidence: number;
  state?: string;
  stateReason?: string | null;
  top3Findings: { id: string; message: string }[];
}

function scoreColor(score: number): string {
  if (score > 70) return 'text-green-500';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-500';
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

/**
 * Extract an install command from a stateReason string.
 * Matches patterns like:
 *   "Install with: cargo install cargo-audit"
 *   "cargo install cargo-outdated"
 *   "npm install -g dependency-cruiser"
 *   "go install golang.org/x/tools/cmd/deadcode@latest"
 */
function extractInstallCommand(text: string): { command: string; description: string } | null {
  // Pattern: "Install with: <command>"
  const installWithMatch = text.match(/Install with:\s*(.+)/i);
  if (installWithMatch) {
    return {
      command: installWithMatch[1].trim(),
      description: text.slice(0, text.indexOf('Install with:')).trim().replace(/[.\s]+$/, ''),
    };
  }

  // Pattern: "Install <tool> for best results: <command>"
  const installForMatch = text.match(/Install\s+\S+\s+for\b[^:]*:\s*(.+)/i);
  if (installForMatch) {
    return {
      command: installForMatch[1].trim(),
      description: text.slice(0, text.indexOf('Install')).trim().replace(/[.\s]+$/, ''),
    };
  }

  // Direct command patterns (cargo install, npm install -g, go install, pip install)
  const directMatch = text.match(/((?:cargo|npm|go|pip)\s+install\s+\S+(?:\s+\S+)*)/);
  if (directMatch) {
    return {
      command: directMatch[1].trim(),
      description: text.replace(directMatch[0], '').trim().replace(/[.\s]+$/, ''),
    };
  }

  return null;
}

function InstallCommandCallout({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const parsed = extractInstallCommand(text);

  if (!parsed) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(parsed.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-700 dark:bg-amber-950/40">
      <div className="flex items-start gap-2">
        <Terminal className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-1.5">
          {parsed.description && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {parsed.description}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <code className="flex-1 truncate rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
              {parsed.command}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded p-0.5 text-amber-600 transition-colors hover:bg-amber-200 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-800 dark:hover:text-amber-200"
              title="Copy command"
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const isStatic = confidence === 1.0;

  if (isStatic) {
    return (
      <Badge
        variant="secondary"
        className="gap-1 bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
      >
        <CheckCircle className="size-3" />
        100%
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="border-dashed text-muted-foreground"
    >
      {pct}%
    </Badge>
  );
}

function formatStateLabel(state: string | undefined): string | null {
  if (!state || state === 'completed') return null;
  return state
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ModuleScoreCard({
  repoId,
  moduleId,
  name,
  score,
  confidence,
  state,
  stateReason,
  top3Findings,
}: ModuleScoreCardProps) {
  const stateLabel = formatStateLabel(state);
  const isScored = !state || state === 'completed';

  return (
    <Link href={`/repo/${repoId}/${moduleId}`} className="block">
      <Card className="h-full transition-colors hover:bg-muted/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{name}</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="cursor-default">
                      <ConfidenceBadge confidence={confidence} />
                    </span>
                  }
                />
                <TooltipContent side="top" className="max-w-[240px]">
                  {confidence === 1.0
                    ? 'Static analysis: deterministic results.'
                    : 'AI analysis: confidence reflects model certainty.'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isScored ? (
            <div className={`text-3xl font-bold ${scoreColor(score)}`}>
              {score}<span className="text-base font-normal text-muted-foreground">/100</span>
            </div>
          ) : (
            <div className="space-y-2">
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                {state === 'unavailable' ? (
                  <AlertTriangle className="size-3" />
                ) : (
                  <MinusCircle className="size-3" />
                )}
                {stateLabel}
              </Badge>
              {state === 'unavailable' && stateReason && extractInstallCommand(stateReason) ? (
                <InstallCommandCallout text={stateReason} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {stateReason ?? 'This module was excluded from the overall score.'}
                </p>
              )}
            </div>
          )}
          {top3Findings.length > 0 && (
            <ul className="space-y-1">
              {top3Findings.map((f) => (
                <li
                  key={f.id}
                  className="text-xs text-muted-foreground truncate"
                  title={f.message}
                >
                  {truncate(f.message)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
