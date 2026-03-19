'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Scan,
  Bot,
  Minus,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComparisonScan {
  id: string;
  status: string;
  overallScore: number | null;
  createdAt: string;
}

interface ComparisonAudit {
  id: string;
  provider: string;
  model: string | null;
  status: string;
  createdAt: string;
}

interface ModuleComparison {
  moduleId: string;
  hasScan: boolean;
  hasAudit: boolean;
  scanScore: number | null;
  scanConfidence: number | null;
  scanSummary: string | null;
  scanFindingCount: number;
  auditSummary: string | null;
  auditFindingCount: number;
}

interface BothFlaggedItem {
  similarity: number;
  scan: {
    severity: string;
    filePath: string | null;
    line: number | null;
    message: string;
    category: string;
    moduleId: string;
  };
  audit: {
    severity: string;
    file: string;
    line?: number;
    message: string;
    category: string;
    moduleId: string;
  };
}

interface ScanOnlyItem {
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  moduleId: string;
}

interface AuditOnlyItem {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
  moduleId: string;
}

interface ComparisonData {
  scan: ComparisonScan | null;
  audit: ComparisonAudit | null;
  moduleComparisons: ModuleComparison[];
  findingDiff: {
    bothFlagged: BothFlaggedItem[];
    scanOnly: ScanOnlyItem[];
    auditOnly: AuditOnlyItem[];
  };
  summary: {
    bothFlaggedCount: number;
    scanOnlyCount: number;
    auditOnlyCount: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatModuleName(moduleId: string): string {
  return moduleId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function SeverityBadge({ severity }: { severity: string }) {
  const colorMap: Record<string, string> = {
    critical:
      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    medium:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    info: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colorMap[severity.toLowerCase()] || colorMap.info}`}
    >
      {severity}
    </span>
  );
}

function ScoreBar({ score, label }: { score: number | null; label: string }) {
  if (score === null) return null;
  const color =
    score >= 70
      ? 'bg-green-500'
      : score >= 40
        ? 'bg-yellow-500'
        : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-12 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-xs font-medium w-8 text-right">{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchComparison() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/repos/${id}/comparison`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || 'Failed to load comparison data');
        }
        const result: ComparisonData = await res.json();
        setData(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load comparison',
        );
      } finally {
        setLoading(false);
      }
    }

    fetchComparison();
  }, [id]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/repo/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to repository
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            Scan vs Audit
          </h1>
          <p className="text-muted-foreground">Loading comparison data...</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-muted/50 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/repo/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to repository
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            Scan vs Audit
          </h1>
        </div>
        <Card>
          <CardContent>
            <p className="text-destructive py-4">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { scan, audit, moduleComparisons, findingDiff, summary } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/repo/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to repository
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Scan vs Audit</h1>
        <p className="text-muted-foreground">
          Comparing static scan findings with independent AI audit results
        </p>
      </div>

      {/* Source Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Scan className="h-4 w-4" />
              Static Scan
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scan ? (
              <div className="space-y-1 text-sm">
                <p>
                  Score:{' '}
                  <span className="font-bold">
                    {scan.overallScore ?? '--'}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {formatDate(scan.createdAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No completed scan available
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="h-4 w-4" />
              AI Audit
            </CardTitle>
          </CardHeader>
          <CardContent>
            {audit ? (
              <div className="space-y-1 text-sm">
                <p>
                  Provider:{' '}
                  <span className="font-medium">{audit.provider}</span>
                  {audit.model && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({audit.model})
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  {formatDate(audit.createdAt)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No completed audit available
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Both Flagged</CardDescription>
            <CardTitle className="text-2xl text-green-600 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              {summary.bothFlaggedCount}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              High confidence -- scan and audit agree
            </p>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Scan Only</CardDescription>
            <CardTitle className="text-2xl text-yellow-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {summary.scanOnlyCount}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              May be false positives
            </p>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Audit Only</CardDescription>
            <CardTitle className="text-2xl text-blue-600 flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              {summary.auditOnlyCount}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              AI caught what static analysis missed
            </p>
          </CardHeader>
        </Card>
      </div>

      {/* Per-Module Comparison */}
      {moduleComparisons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-Module Comparison</CardTitle>
            <CardDescription>
              Side-by-side view of scan scores and audit summaries per module
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-0 divide-y">
            {moduleComparisons.map((mod) => (
              <div key={mod.moduleId} className="py-4 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-sm font-semibold">
                    {formatModuleName(mod.moduleId)}
                  </h3>
                  {mod.hasScan && mod.hasAudit && (
                    <Badge
                      variant="outline"
                      className="text-green-600 border-green-500/50"
                    >
                      Both covered
                    </Badge>
                  )}
                  {mod.hasScan && !mod.hasAudit && (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground border-muted-foreground/30"
                    >
                      No audit data
                    </Badge>
                  )}
                  {!mod.hasScan && mod.hasAudit && (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground border-muted-foreground/30"
                    >
                      No scan data
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Scan side */}
                  <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Scan className="h-3 w-3" />
                      Scan
                    </p>
                    {mod.hasScan ? (
                      <>
                        <ScoreBar
                          score={mod.scanScore}
                          label="Score"
                        />
                        {mod.scanSummary && (
                          <p className="text-xs text-muted-foreground">
                            {mod.scanSummary}
                          </p>
                        )}
                        <p className="text-xs">
                          {mod.scanFindingCount} finding
                          {mod.scanFindingCount !== 1 ? 's' : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Not covered by scan
                      </p>
                    )}
                  </div>

                  {/* Audit side */}
                  <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Bot className="h-3 w-3" />
                      Audit
                    </p>
                    {mod.hasAudit ? (
                      <>
                        {mod.auditSummary && (
                          <p className="text-xs text-muted-foreground">
                            {mod.auditSummary}
                          </p>
                        )}
                        <p className="text-xs">
                          {mod.auditFindingCount} finding
                          {mod.auditFindingCount !== 1 ? 's' : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Not covered by audit
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Both Flagged */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Both Flagged
          </CardTitle>
          <CardDescription>
            Issues identified by both scan and audit -- high confidence findings
          </CardDescription>
        </CardHeader>
        <CardContent>
          {findingDiff.bothFlagged.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No matched findings between scan and audit.
            </p>
          ) : (
            <div className="divide-y">
              {findingDiff.bothFlagged.map((item, i) => (
                <div key={i} className="py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={item.scan.severity} />
                    <Badge variant="outline" className="text-xs">
                      {Math.round(item.similarity * 100)}% match
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="text-sm space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                        <Scan className="h-3 w-3" />
                        Scan
                      </p>
                      <p className="text-sm">{item.scan.message}</p>
                      {item.scan.filePath && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {item.scan.filePath}
                          {item.scan.line != null ? `:${item.scan.line}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-sm space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                        <Bot className="h-3 w-3" />
                        Audit
                      </p>
                      <p className="text-sm">{item.audit.message}</p>
                      {item.audit.file && (
                        <p className="text-xs text-muted-foreground font-mono">
                          {item.audit.file}
                          {item.audit.line != null
                            ? `:${item.audit.line}`
                            : ''}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scan Only */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Scan Only
          </CardTitle>
          <CardDescription>
            Flagged by static analysis but not by AI audit -- may be false
            positives worth reviewing
          </CardDescription>
        </CardHeader>
        <CardContent>
          {findingDiff.scanOnly.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No scan-only findings -- audit confirmed all scan results.
            </p>
          ) : (
            <div className="divide-y">
              {findingDiff.scanOnly.map((item, i) => (
                <div key={i} className="py-3 flex items-start gap-3">
                  <SeverityBadge severity={item.severity} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.message}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.moduleId}
                      {item.filePath && (
                        <>
                          {' -- '}
                          <span className="font-mono">
                            {item.filePath}
                            {item.line != null ? `:${item.line}` : ''}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit Only */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-blue-600" />
            Audit Only
          </CardTitle>
          <CardDescription>
            Caught by AI audit but missed by static analysis -- unique AI
            insights
          </CardDescription>
        </CardHeader>
        <CardContent>
          {findingDiff.auditOnly.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No audit-only findings -- static scan caught everything the
              audit found.
            </p>
          ) : (
            <div className="divide-y">
              {findingDiff.auditOnly.map((item, i) => (
                <div key={i} className="py-3 flex items-start gap-3">
                  <SeverityBadge severity={item.severity} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.message}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.moduleId}
                      {item.file && (
                        <>
                          {' -- '}
                          <span className="font-mono">
                            {item.file}
                            {item.line != null ? `:${item.line}` : ''}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Empty state when neither scan nor audit exists */}
      {!scan && !audit && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Run both a scan and an audit to see how their findings compare.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
