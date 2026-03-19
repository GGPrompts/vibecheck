'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScoreGauge } from '@/components/score-gauge';
import { FindingsTable } from '@/components/findings-table';
import { PromptOutput } from '@/components/prompt-output';
import { ScanProgress } from '@/components/scan-progress';
import { AuditProgress } from '@/components/audit-progress';
import { ModuleScoreCard } from '@/components/module-score-card';
import { HotspotQuadrant } from '@/components/hotspot-quadrant';
import { RadarChart } from '@/components/radar-chart';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Loader2, Play, Sparkles, ShieldAlert, ClipboardCopy, Check, Download, FileText, Globe, Search, GitCompareArrows, Network } from 'lucide-react';

interface RepoData {
  id: string;
  name: string;
  path: string;
  mode?: 'maintaining' | 'evaluating';
  latestScan: {
    id: string;
    status: string;
    overallScore: number | null;
    createdAt: string;
  } | null;
}

interface ScanFinding {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
  moduleId?: string;
}

interface ScanModule {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  metrics: Record<string, number> | null;
  findings: ScanFinding[];
}

interface ScanDetail {
  scan: {
    id: string;
    repoId: string;
    status: string;
    overallScore: number | null;
    durationMs: number | null;
    createdAt: string;
  };
  modules: ScanModule[];
}

type EvaluationVerdict = 'low-risk' | 'moderate-risk' | 'high-risk' | 'avoid';

interface EvaluationResult {
  adoptionRisk: number;
  verdict: EvaluationVerdict;
  reasons: string[];
}

interface AuditFinding {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
}

interface AuditModule {
  id: string;
  moduleId: string;
  summary: string;
  findings: AuditFinding[];
  tokensUsed: number | null;
  durationMs: number | null;
}

interface AuditDetail {
  audit: {
    id: string;
    repoId: string;
    provider: string;
    model: string | null;
    status: string;
    durationMs: number | null;
    createdAt: string;
  };
  modules: AuditModule[];
}

type AuditProvider = 'claude-api' | 'claude-cli' | 'codex';

const PROVIDER_LABELS: Record<AuditProvider, string> = {
  'claude-api': 'Claude API',
  'claude-cli': 'Claude CLI',
  codex: 'Codex',
};

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Client-side evaluation score computation.
 * Mirrors the server-side logic in evaluation-scorer.ts.
 */
function computeClientEvaluation(modules: ScanModule[]): EvaluationResult {
  const reasons: string[] = [];

  // Check for critical security findings (hard stop)
  const criticalSecurityFindings = modules.flatMap((m) =>
    m.findings.filter(
      (f) => f.severity === 'critical' && (f.category === 'security' || m.moduleId === 'security'),
    ),
  );

  if (criticalSecurityFindings.length > 0) {
    return {
      adoptionRisk: 100,
      verdict: 'avoid',
      reasons: [
        `BLOCKING: ${criticalSecurityFindings.length} critical security issue${criticalSecurityFindings.length > 1 ? 's' : ''} found -- must be resolved before adoption`,
      ],
    };
  }

  // Evaluation weights
  const EVAL_WEIGHTS: Record<string, number> = {
    dependencies: 2,
    dependency: 2,
    security: 1.5,
    'git-health': 1.5,
    'git_health': 1.5,
    'bus-factor': 1.5,
    'bus_factor': 1.5,
    complexity: 1,
    'code-quality': 1,
    'code_quality': 1,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const mod of modules) {
    const baseWeight = EVAL_WEIGHTS[mod.moduleId] ?? 1;
    const effectiveWeight = baseWeight * mod.confidence;
    weightedSum += mod.score * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  const healthScore = totalWeight > 0 ? weightedSum / totalWeight : 50;
  let risk = 100 - healthScore;

  // Check for high-severity security findings
  const highSecurityFindings = modules.flatMap((m) =>
    m.findings.filter(
      (f) => f.severity === 'high' && (f.category === 'security' || m.moduleId === 'security'),
    ),
  );
  if (highSecurityFindings.length > 0) {
    reasons.push(
      `${highSecurityFindings.length} high-severity security issue${highSecurityFindings.length > 1 ? 's' : ''} found`,
    );
    risk = Math.min(100, risk + highSecurityFindings.length * 3);
  }

  // Check dependency modules for severely outdated deps
  const depModules = modules.filter(
    (m) => m.moduleId === 'dependencies' || m.moduleId === 'dependency',
  );
  for (const dm of depModules) {
    const critFindings = dm.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'critical',
    );
    if (critFindings.length > 0) {
      reasons.push(
        `${critFindings.length} dependency update${critFindings.length > 1 ? 's' : ''} needed (high/critical)`,
      );
      risk = Math.min(100, risk + 5);
    }
  }

  // Check bus factor / git health
  const gitModules = modules.filter(
    (m) =>
      m.moduleId === 'git-health' ||
      m.moduleId === 'git_health' ||
      m.moduleId === 'bus-factor' ||
      m.moduleId === 'bus_factor',
  );
  for (const gm of gitModules) {
    if (gm.score < 40) {
      reasons.push('Git health score is low -- potential bus factor or maintenance risk');
      risk = Math.min(100, risk + 8);
    }
  }

  // Default reason
  if (reasons.length === 0) {
    if (risk < 30) {
      reasons.push('No major adoption concerns identified');
    } else if (risk < 60) {
      reasons.push('Some module scores are below healthy thresholds');
    } else {
      reasons.push(
        'Multiple modules scored poorly -- adoption would require significant effort',
      );
    }
  }

  const finalRisk = Math.round(Math.max(0, Math.min(100, risk)));

  let verdict: EvaluationVerdict;
  if (finalRisk < 30) verdict = 'low-risk';
  else if (finalRisk < 60) verdict = 'moderate-risk';
  else if (finalRisk < 80) verdict = 'high-risk';
  else verdict = 'avoid';

  return { adoptionRisk: finalRisk, verdict, reasons };
}

function VerdictBadge({ verdict }: { verdict: EvaluationVerdict }) {
  const config: Record<EvaluationVerdict, { label: string; className: string }> = {
    'low-risk': {
      label: 'Low Risk',
      className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700',
    },
    'moderate-risk': {
      label: 'Moderate Risk',
      className: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700',
    },
    'high-risk': {
      label: 'High Risk',
      className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700',
    },
    avoid: {
      label: 'Avoid',
      className: 'bg-red-200 text-red-900 border-red-500 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800',
    },
  };

  const c = config[verdict];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${c.className}`}
    >
      {c.label}
    </span>
  );
}

function EvaluationPromptOutput({ scanId }: { scanId: string }) {
  const [prompt, setPrompt] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const res = await fetch(`/api/scans/${scanId}/evaluation-prompt`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Failed to generate evaluation report');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={handleGenerate} disabled={loading} variant="default">
          {loading ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : (
            <ShieldAlert className="size-4" data-icon="inline-start" />
          )}
          {loading ? 'Generating...' : 'Generate Evaluation Report'}
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
    </div>
  );
}

export default function RepoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [repo, setRepo] = React.useState<RepoData | null>(null);
  const [scanDetail, setScanDetail] = React.useState<ScanDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [scanLoading, setScanLoading] = React.useState(false);
  const [activeScanId, setActiveScanId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Audit state
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [activeAuditId, setActiveAuditId] = React.useState<string | null>(null);
  const [auditProvider, setAuditProvider] = React.useState<AuditProvider>('claude-api');
  const [auditDetail, setAuditDetail] = React.useState<AuditDetail | null>(null);
  const [auditProviderCount, setAuditProviderCount] = React.useState(0);

  const isEvaluation = repo?.mode === 'evaluating';

  const fetchData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch repo data
      const reposRes = await fetch('/api/repos');
      if (!reposRes.ok) throw new Error('Failed to fetch repos');
      const allRepos: RepoData[] = await reposRes.json();
      const currentRepo = allRepos.find((r) => r.id === id);
      if (!currentRepo) {
        setError('Repository not found');
        return;
      }
      setRepo(currentRepo);

      // If there's a latest scan, fetch its details
      if (currentRepo.latestScan) {
        const scanRes = await fetch(`/api/scans/${currentRepo.latestScan.id}`);
        if (scanRes.ok) {
          const data: ScanDetail = await scanRes.json();
          // Attach moduleId to each finding for the combined table
          const enrichedModules = data.modules.map((mod) => ({
            ...mod,
            findings: mod.findings.map((f) => ({
              ...f,
              moduleId: mod.moduleId,
            })),
          }));
          setScanDetail({ ...data, modules: enrichedModules });
        }
      }

      // Fetch latest audit for this repo and count distinct completed providers
      try {
        const auditsRes = await fetch('/api/audits');
        if (auditsRes.ok) {
          const allAudits = await auditsRes.json();
          const repoAudits = allAudits.filter(
            (a: { repoId: string }) => a.repoId === currentRepo.id
          );

          // Count distinct providers with completed audits
          const completedProviders = new Set(
            repoAudits
              .filter((a: { status: string }) => a.status === 'completed')
              .map((a: { provider: string }) => a.provider)
          );
          setAuditProviderCount(completedProviders.size);

          // Load the latest audit detail
          const latestAudit = repoAudits[0];
          if (latestAudit) {
            const auditRes = await fetch(`/api/audits/${latestAudit.id}`);
            if (auditRes.ok) {
              const data: AuditDetail = await auditRes.json();
              setAuditDetail(data);
            }
          }
        }
      } catch {
        // Non-critical — audit data is supplementary
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleScanNow = async () => {
    try {
      setScanLoading(true);
      setError(null);
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to start scan');
        return;
      }
      setActiveScanId(data.scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setScanLoading(false);
    }
  };

  const handleScanComplete = () => {
    setActiveScanId(null);
    fetchData();
  };

  const handleAuditComplete = () => {
    setActiveAuditId(null);
    fetchData();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="flex gap-6">
          <Skeleton className="h-32 w-32 rounded-full" />
          <div className="space-y-3 flex-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-6 w-40" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !repo) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Repository</h1>
        <Card>
          <CardContent>
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!repo) return null;

  const allFindings: ScanFinding[] =
    scanDetail?.modules.flatMap((m) => m.findings) ?? [];

  const modulesPassing =
    scanDetail?.modules.filter((m) => m.score > 60).length ?? 0;
  const totalModules = scanDetail?.modules.length ?? 0;

  // Compute evaluation result if in evaluation mode
  const evaluationResult: EvaluationResult | null =
    isEvaluation && scanDetail ? computeClientEvaluation(scanDetail.modules) : null;

  // Build hotspot data from complexity metrics if available
  const hotspotData: {
    fileName: string;
    churn: number;
    complexity: number;
    quadrant: 'toxic' | 'frozen' | 'quick-win' | 'healthy';
  }[] = [];
  if (scanDetail) {
    for (const mod of scanDetail.modules) {
      if (mod.metrics) {
        // Generate placeholder hotspot data from findings
        for (const finding of mod.findings) {
          if (finding.filePath) {
            const complexity = finding.severity === 'critical' ? 80 : finding.severity === 'high' ? 60 : 30;
            const churn = Math.random() * 100;
            let quadrant: 'toxic' | 'frozen' | 'quick-win' | 'healthy';
            if (complexity > 50 && churn > 50) quadrant = 'toxic';
            else if (complexity > 50 && churn <= 50) quadrant = 'frozen';
            else if (complexity <= 50 && churn > 50) quadrant = 'quick-win';
            else quadrant = 'healthy';
            hotspotData.push({
              fileName: finding.filePath,
              churn,
              complexity,
              quadrant,
            });
          }
        }
      }
    }
  }

  // Identify blocking issues for evaluation mode
  const blockingFindings = isEvaluation
    ? allFindings.filter(
        (f) =>
          f.severity === 'critical' ||
          (f.category === 'security' && f.severity === 'high'),
      )
    : [];

  // Score display for evaluation mode
  const displayScore = isEvaluation
    ? evaluationResult?.adoptionRisk ?? null
    : scanDetail?.scan.overallScore ?? repo.latestScan?.overallScore ?? null;

  return (
    <div className="space-y-8">
      {/* Summary Row */}
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
          <Button onClick={handleScanNow} disabled={scanLoading || !!activeScanId}>
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
                  onClick={() => {
                    setAuditProvider(p);
                    // Trigger audit immediately with selected provider
                    setAuditLoading(true);
                    setError(null);
                    fetch('/api/audits', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ repoId: id, provider: p }),
                    })
                      .then((res) => res.json())
                      .then((data) => {
                        if (data.error) {
                          setError(data.error);
                        } else {
                          setActiveAuditId(data.auditId);
                        }
                      })
                      .catch((err) => {
                        setError(
                          err instanceof Error ? err.message : 'Network error'
                        );
                      })
                      .finally(() => setAuditLoading(false));
                  }}
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

      {/* Evaluation: Reasons & Blocking Issues */}
      {isEvaluation && evaluationResult && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Adoption Assessment</h2>
          <Card className="border-dashed border-2 border-amber-500/40">
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Risk Factors
                </h3>
                <ul className="space-y-1">
                  {evaluationResult.reasons.map((reason, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <span
                        className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${
                          reason.startsWith('BLOCKING')
                            ? 'bg-red-500'
                            : 'bg-amber-500'
                        }`}
                      />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
              {blockingFindings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-red-600 uppercase tracking-wide">
                    Blocking Issues ({blockingFindings.length})
                  </h3>
                  <ul className="space-y-1">
                    {blockingFindings.slice(0, 10).map((f) => (
                      <li key={f.id} className="text-sm text-red-600">
                        [{f.severity}] {f.filePath}: {f.message}
                      </li>
                    ))}
                    {blockingFindings.length > 10 && (
                      <li className="text-sm text-muted-foreground">
                        ...and {blockingFindings.length - 10} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Active Scan Progress */}
      {activeScanId && (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEvaluation ? 'Evaluation in Progress' : 'Scan in Progress'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScanProgress scanId={activeScanId} onComplete={handleScanComplete} />
          </CardContent>
        </Card>
      )}

      {/* Active Audit Progress */}
      {activeAuditId && (
        <Card>
          <CardHeader>
            <CardTitle>AI Audit in Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditProgress auditId={activeAuditId} onComplete={handleAuditComplete} />
          </CardContent>
        </Card>
      )}

      {/* Module Grid */}
      {scanDetail && scanDetail.modules.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Modules</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {scanDetail.modules.map((mod) => (
              <ModuleScoreCard
                key={mod.moduleId}
                repoId={id}
                moduleId={mod.moduleId}
                name={mod.moduleId
                  .split('-')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ')}
                score={mod.score}
                confidence={mod.confidence}
                top3Findings={mod.findings.slice(0, 3).map((f) => ({
                  id: f.id,
                  message: f.message,
                }))}
              />
            ))}
          </div>
        </section>
      )}

      {/* Radar Chart & Hotspot Quadrant (side by side on desktop) */}
      {scanDetail && scanDetail.modules.length > 0 && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar Chart */}
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Module Scores</h2>
              <Card>
                <CardContent className="pt-4">
                  <RadarChart
                    data={scanDetail.modules.map((mod) => ({
                      moduleId: mod.moduleId,
                      moduleName: mod.moduleId
                        .split('-')
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' '),
                      score: mod.score,
                      confidence: mod.confidence,
                    }))}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Hotspot Quadrant */}
            {hotspotData.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold">Hotspot Quadrant</h2>
                <HotspotQuadrant data={hotspotData} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Findings Table */}
      {scanDetail && allFindings.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">All Findings</h2>
          <FindingsTable findings={allFindings} />
        </section>
      )}

      {/* Latest AI Audit Summary */}
      {auditDetail && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold">AI Audit</h2>
              {auditProviderCount >= 2 && (
                <Link href={`/repo/${id}/compare-audits`}>
                  <Button variant="outline" size="sm">
                    <GitCompareArrows className="size-4" data-icon="inline-start" />
                    Compare Audits
                  </Button>
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">
                {PROVIDER_LABELS[auditDetail.audit.provider as AuditProvider] ??
                  auditDetail.audit.provider}
              </Badge>
              <Badge
                variant={
                  auditDetail.audit.status === 'completed'
                    ? 'default'
                    : auditDetail.audit.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {auditDetail.audit.status}
              </Badge>
              {auditDetail.audit.durationMs && (
                <span>{formatDuration(auditDetail.audit.durationMs)}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {auditDetail.modules.map((mod) => {
              const findingCount = mod.findings.length;
              const severityCounts: Record<string, number> = {};
              for (const f of mod.findings) {
                severityCounts[f.severity] =
                  (severityCounts[f.severity] ?? 0) + 1;
              }

              return (
                <Card key={mod.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base capitalize">
                      {mod.moduleId.replace(/-/g, ' ')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {mod.summary && (
                      <p className="text-sm text-muted-foreground">
                        {mod.summary}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">
                        {findingCount} finding
                        {findingCount !== 1 ? 's' : ''}
                      </Badge>
                      {severityCounts.critical && (
                        <Badge variant="destructive">
                          {severityCounts.critical} critical
                        </Badge>
                      )}
                      {severityCounts.high && (
                        <Badge
                          variant="destructive"
                          className="bg-orange-600"
                        >
                          {severityCounts.high} high
                        </Badge>
                      )}
                      {severityCounts.medium && (
                        <Badge variant="secondary">
                          {severityCounts.medium} medium
                        </Badge>
                      )}
                    </div>

                    {mod.findings.length > 0 && (
                      <ul className="space-y-1 text-xs">
                        {mod.findings.slice(0, 5).map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span
                              className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                                f.severity === 'critical'
                                  ? 'bg-red-500'
                                  : f.severity === 'high'
                                    ? 'bg-orange-500'
                                    : f.severity === 'medium'
                                      ? 'bg-yellow-500'
                                      : 'bg-blue-400'
                              }`}
                            />
                            <span className="text-muted-foreground">
                              {f.file && (
                                <span className="font-mono text-foreground">
                                  {f.file}
                                  {f.line ? `:${f.line}` : ''}
                                </span>
                              )}{' '}
                              {f.message}
                            </span>
                          </li>
                        ))}
                        {mod.findings.length > 5 && (
                          <li className="text-muted-foreground">
                            ...and {mod.findings.length - 5} more
                          </li>
                        )}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state when no scan exists */}
      {!scanDetail && !activeScanId && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              {isEvaluation
                ? 'No evaluation results yet. Run your first evaluation to see adoption risk metrics.'
                : 'No scan results yet. Run your first scan to see health metrics.'}
            </p>
            <Button onClick={handleScanNow} disabled={scanLoading}>
              {scanLoading ? (
                <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
              ) : isEvaluation ? (
                <ShieldAlert className="size-4" data-icon="inline-start" />
              ) : (
                <Play className="size-4" data-icon="inline-start" />
              )}
              {isEvaluation ? 'Run First Evaluation' : 'Run First Scan'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
