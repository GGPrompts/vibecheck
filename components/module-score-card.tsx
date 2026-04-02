'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle, MinusCircle } from 'lucide-react';
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
              <p className="text-sm text-muted-foreground">
                {stateReason ?? 'This module was excluded from the overall score.'}
              </p>
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
