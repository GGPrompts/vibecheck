'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ScoreGauge } from '@/components/score-gauge';
import { PromptOutput } from '@/components/prompt-output';
import { Loader2, Play, Sparkles, ShieldAlert, Download, FileText, Globe, Search, GitCompareArrows, Network } from 'lucide-react';
import { EvaluationPromptOutput } from './evaluation-prompt-output';
import { VerdictBadge } from './verdict-badge';
import { formatDuration } from './evaluation-utils';
import type { RepoData, ScanDetail, AuditDetail, AuditProvider, EvaluationResult, ScanFinding } from './types';
import { PROVIDER_LABELS } from './types';

interface RepoHeaderProps {
  repo: RepoData;
  scanDetail: ScanDetail | null;
  auditDetail: AuditDetail | null;
  evaluationResult: EvaluationResult | null;
  isEvaluation: boolean;
  displayScore: number | null;
  allFindings: ScanFinding[];
  modulesPassing: number;
  totalModules: number;
  error: string | null;
  scanLoading: boolean;
  auditLoading: boolean;
  activeScanId: string | null;
  activeAuditId: string | null;
  onScanNow: () => void;
  onStartAudit: (provider: AuditProvider) => void;
}

export function RepoHeader({
  repo,
  scanDetail,
  auditDetail,
  evaluationResult,
  isEvaluation,
  displayScore,
  allFindings,
  modulesPassing,
  totalModules,
  error,
  scanLoading,
  auditLoading,
  activeScanId,
  activeAuditId,
  onScanNow,
  onStartAudit,
}: RepoHeaderProps) {
  const id = repo.id;

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-6">
        <ScoreGauge
          score={displayScore}
          size={120}
          invertColors={isEvaluation}
        />
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{repo.name}</h1>
            {isEvaluation && (
              <Badge variant="outline" className="text-amber-600 border-amber-500/50">
                Evaluation Mode
              </Badge>
            )}
          </div>
          {isEvaluation && evaluationResult && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">
                Adoption Risk: {evaluationResult.adoptionRisk}%
              </span>
              <VerdictBadge verdict={evaluationResult.verdict} />
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span>
              <strong className="text-foreground">{allFindings.length}</strong>{' '}
              findings
            </span>
            <span>
              <strong className="text-foreground">
                {modulesPassing}/{totalModules}
              </strong>{' '}
              modules passing
            </span>
            <span>
              Duration:{' '}
              <strong className="text-foreground">
                {formatDuration(scanDetail?.scan.durationMs)}
              </strong>
            </span>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        <Button onClick={onScanNow} disabled={scanLoading || !!activeScanId}>
          {scanLoading ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : isEvaluation ? (
            <ShieldAlert className="size-4" data-icon="inline-start" />
          ) : (
            <Play className="size-4" data-icon="inline-start" />
          )}
          {scanLoading
            ? 'Starting...'
            : isEvaluation
              ? 'Evaluate'
              : 'Scan Now'}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                disabled={auditLoading || !!activeAuditId}
              >
                {auditLoading ? (
                  <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
                ) : (
                  <Search className="size-4" data-icon="inline-start" />
                )}
                {auditLoading ? 'Starting...' : 'Audit'}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {(
              ['claude-api', 'claude-cli', 'codex'] as AuditProvider[]
            ).map((p) => (
              <DropdownMenuItem
                key={p}
                onClick={() => onStartAudit(p)}
              >
                {PROVIDER_LABELS[p]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {scanDetail && (
          <Sheet>
            <SheetTrigger
              render={
                <Button variant="outline">
                  {isEvaluation ? (
                    <ShieldAlert className="size-4" data-icon="inline-start" />
                  ) : (
                    <Sparkles className="size-4" data-icon="inline-start" />
                  )}
                  {isEvaluation
                    ? 'Generate Evaluation Report'
                    : 'Generate Claude Prompt'}
                </Button>
              }
            />
            <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
              <SheetHeader>
                <SheetTitle>
                  {isEvaluation ? 'Evaluation Report' : 'Claude Prompt'}
                </SheetTitle>
                <SheetDescription>
                  {isEvaluation
                    ? 'Generate an adoption evaluation report with risk assessment and effort estimates.'
                    : 'Generate a prompt with scan findings for Claude to help fix issues.'}
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                {isEvaluation ? (
                  <EvaluationPromptOutput scanId={scanDetail.scan.id} />
                ) : (
                  <PromptOutput scanId={scanDetail.scan.id} />
                )}
              </div>
            </SheetContent>
          </Sheet>
        )}

        {scanDetail && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline">
                  <Download className="size-4" data-icon="inline-start" />
                  Export Report
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  window.open(
                    `/api/reports/${scanDetail.scan.id}?format=md&download=true`,
                    '_blank',
                  );
                }}
              >
                <FileText className="size-4" data-icon="inline-start" />
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  window.open(
                    `/api/reports/${scanDetail.scan.id}?format=html&download=true`,
                    '_blank',
                  );
                }}
              >
                <Globe className="size-4" data-icon="inline-start" />
                HTML (.html)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {(scanDetail || auditDetail) && (
          <Link href={`/repo/${id}/comparison`}>
            <Button variant="outline">
              <GitCompareArrows className="size-4" data-icon="inline-start" />
              Scan vs Audit
            </Button>
          </Link>
        )}

        <Link href={`/repo/${id}/map`}>
          <Button variant="outline">
            <Network className="size-4" data-icon="inline-start" />
            Map
          </Button>
        </Link>
      </div>
    </div>
  );
}
