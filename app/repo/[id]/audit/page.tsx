'use client';

import { useEffect, useState, useMemo, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Code,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Scan {
  id: string;
  repoId: string | null;
  repoName: string | null;
  status: string;
  overallScore: number | null;
  durationMs: number | null;
  createdAt: string;
}

interface Finding {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

interface ModuleResult {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  findings: Finding[];
}

interface ScanDetail {
  scan: {
    id: string;
    repoId: string | null;
    status: string;
    overallScore: number | null;
    durationMs: number | null;
    createdAt: string;
  };
  modules: ModuleResult[];
}

interface AuditEntry {
  scan: Scan;
  detail: ScanDetail | null;
  delta: number | null;
  moduleDiffs: Array<{
    moduleId: string;
    current: number;
    previous: number;
    diff: number;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function deltaColor(delta: number | null): string {
  if (delta === null || delta === 0) return 'text-muted-foreground';
  return delta > 0 ? 'text-green-500' : 'text-red-500';
}

function deltaPrefix(delta: number | null): string {
  if (delta === null) return '';
  if (delta > 0) return '+';
  return '';
}

function statusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'running':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [scans, setScans] = useState<Scan[]>([]);
  const [scanDetails, setScanDetails] = useState<Map<string, ScanDetail>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  // Fetch scans and details
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const scansRes = await fetch('/api/scans');
        if (!scansRes.ok) throw new Error('Failed to fetch scans');

        const allScans: Scan[] = await scansRes.json();
        const repoScans = allScans
          .filter((s) => s.repoId === id)
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );

        setScans(repoScans);

        // Fetch module details for completed scans
        const detailsMap = new Map<string, ScanDetail>();
        const detailPromises = repoScans
          .filter((s) => s.status === 'completed')
          .map(async (scan) => {
            try {
              const res = await fetch(`/api/scans/${scan.id}`);
              if (res.ok) {
                const detail: ScanDetail = await res.json();
                detailsMap.set(scan.id, detail);
              }
            } catch {
              // Skip failed detail fetches
            }
          });

        await Promise.all(detailPromises);
        setScanDetails(detailsMap);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load audit data'
        );
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  // Build audit entries with deltas
  const auditEntries: AuditEntry[] = useMemo(() => {
    return scans.map((scan, index) => {
      const detail = scanDetails.get(scan.id) ?? null;
      const prevScan = scans[index + 1]; // Sorted desc, so next index is previous scan
      const prevDetail = prevScan ? scanDetails.get(prevScan.id) : null;

      // Overall score delta
      let delta: number | null = null;
      if (
        scan.overallScore !== null &&
        prevScan?.overallScore !== null &&
        prevScan?.overallScore !== undefined
      ) {
        delta = scan.overallScore - prevScan.overallScore;
      }

      // Module-level diffs
      const moduleDiffs: AuditEntry['moduleDiffs'] = [];
      if (detail && prevDetail) {
        for (const mod of detail.modules) {
          const prevMod = prevDetail.modules.find(
            (m) => m.moduleId === mod.moduleId
          );
          if (prevMod && mod.score !== prevMod.score) {
            moduleDiffs.push({
              moduleId: mod.moduleId,
              current: mod.score,
              previous: prevMod.score,
              diff: mod.score - prevMod.score,
            });
          }
        }
      }

      return { scan, detail, delta, moduleDiffs };
    });
  }, [scans, scanDetails]);

  // Export report
  async function handleExport(format: 'markdown' | 'html') {
    setExportingFormat(format);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: id, format }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate report');
      }

      const data = await res.json();
      const ext = format === 'markdown' ? 'md' : 'html';
      const mimeType =
        format === 'markdown' ? 'text/markdown' : 'text/html';
      const blob = new Blob([data.report], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.download = `vibecheck-report-${new Date().toISOString().slice(0, 10)}.${ext}`;
      link.href = url;
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Report export failed:', err);
    } finally {
      setExportingFormat(null);
    }
  }

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
          <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
          <p className="text-muted-foreground">Loading scan history...</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-xl bg-muted/50 animate-pulse"
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
          <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
        </div>
        <Card>
          <CardContent>
            <p className="text-destructive py-4">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/repo/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to repository
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
          <p className="text-muted-foreground">
            Complete scan history and compliance reporting
          </p>
        </div>

        {/* Export buttons */}
        <div className="flex gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('markdown')}
            disabled={exportingFormat !== null}
          >
            <FileText className="h-4 w-4 mr-1.5" />
            {exportingFormat === 'markdown' ? 'Generating...' : 'Export Markdown'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('html')}
            disabled={exportingFormat !== null}
          >
            <Code className="h-4 w-4 mr-1.5" />
            {exportingFormat === 'html' ? 'Generating...' : 'Export HTML'}
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {scans.length === 0 && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Clock className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No scans yet</h3>
              <p className="text-muted-foreground max-w-md">
                Run a scan from the repository page to start building your audit
                trail.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Scan Timeline */}
      {auditEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Scan Timeline</CardTitle>
            <CardDescription>
              {scans.length} scan{scans.length !== 1 ? 's' : ''} recorded
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {auditEntries.map((entry) => {
                const isExpanded = expandedScan === entry.scan.id;
                const DeltaIcon =
                  entry.delta !== null && entry.delta > 0
                    ? TrendingUp
                    : entry.delta !== null && entry.delta < 0
                      ? TrendingDown
                      : Minus;

                return (
                  <div key={entry.scan.id}>
                    {/* Scan row */}
                    <button
                      className="w-full text-left px-6 py-4 hover:bg-muted/50 transition-colors flex items-center gap-4"
                      onClick={() =>
                        setExpandedScan(isExpanded ? null : entry.scan.id)
                      }
                    >
                      {/* Expand icon */}
                      <div className="text-muted-foreground">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </div>

                      {/* Timestamp */}
                      <div className="min-w-[180px]">
                        <p className="text-sm font-medium">
                          {formatDate(entry.scan.createdAt)}
                        </p>
                      </div>

                      {/* Status */}
                      <Badge variant={statusBadgeVariant(entry.scan.status)}>
                        {entry.scan.status}
                      </Badge>

                      {/* Score */}
                      <div className="min-w-[60px] text-center">
                        {entry.scan.overallScore !== null ? (
                          <span className="text-lg font-bold">
                            {entry.scan.overallScore}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </div>

                      {/* Delta */}
                      <div
                        className={`min-w-[70px] flex items-center gap-1 ${deltaColor(entry.delta)}`}
                      >
                        {entry.delta !== null ? (
                          <>
                            <DeltaIcon className="h-4 w-4" />
                            <span className="text-sm font-medium">
                              {deltaPrefix(entry.delta)}
                              {entry.delta}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            --
                          </span>
                        )}
                      </div>

                      {/* Duration */}
                      <div className="flex items-center gap-1 text-sm text-muted-foreground ml-auto">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDuration(entry.scan.durationMs)}
                      </div>
                    </button>

                    {/* Expanded module diffs */}
                    {isExpanded && entry.detail && (
                      <div className="px-6 pb-4 pl-16 space-y-3">
                        {/* Module scores */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                            Module Scores
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {entry.detail.modules.map((mod) => {
                              const moduleDiff = entry.moduleDiffs.find(
                                (d) => d.moduleId === mod.moduleId
                              );
                              return (
                                <div
                                  key={mod.moduleId}
                                  className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-md"
                                >
                                  <span className="text-sm font-medium">
                                    {mod.moduleId}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold">
                                      {mod.score}
                                    </span>
                                    {moduleDiff && (
                                      <span
                                        className={`text-xs font-medium ${deltaColor(moduleDiff.diff)}`}
                                      >
                                        {deltaPrefix(moduleDiff.diff)}
                                        {moduleDiff.diff}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Finding summary */}
                        {entry.detail.modules.some(
                          (m) => m.findings.length > 0
                        ) && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                              Findings Summary
                            </p>
                            <div className="flex gap-2 flex-wrap mb-3">
                              {(() => {
                                const counts: Record<string, number> = {};
                                entry.detail!.modules.forEach((m) => {
                                  m.findings.forEach((f) => {
                                    const sev = f.severity.toLowerCase();
                                    counts[sev] = (counts[sev] || 0) + 1;
                                  });
                                });
                                return Object.entries(counts)
                                  .sort(
                                    (a, b) =>
                                      ['critical', 'high', 'medium', 'low', 'info'].indexOf(a[0]) -
                                      ['critical', 'high', 'medium', 'low', 'info'].indexOf(b[0])
                                  )
                                  .map(([sev, count]) => (
                                    <Badge
                                      key={sev}
                                      variant={
                                        sev === 'critical' || sev === 'high'
                                          ? 'destructive'
                                          : 'secondary'
                                      }
                                    >
                                      {count} {sev}
                                    </Badge>
                                  ));
                              })()}
                            </div>

                            {/* Per-module findings detail */}
                            <div className="space-y-3">
                              {entry.detail!.modules
                                .filter((m) => m.findings.length > 0)
                                .map((mod) => (
                                  <div key={mod.moduleId}>
                                    <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                                      {mod.moduleId}{' '}
                                      <span className="text-muted-foreground/60">
                                        ({mod.findings.length} finding
                                        {mod.findings.length !== 1 ? 's' : ''})
                                      </span>
                                    </p>
                                    <div className="space-y-1">
                                      {mod.findings.slice(0, 10).map((f) => (
                                        <div
                                          key={f.id}
                                          className="flex items-start gap-2 text-xs px-2.5 py-1.5 bg-background rounded border border-border/50"
                                        >
                                          <Badge
                                            variant={
                                              f.severity === 'critical' ||
                                              f.severity === 'high'
                                                ? 'destructive'
                                                : 'secondary'
                                            }
                                            className="text-[10px] px-1.5 py-0 shrink-0 mt-0.5"
                                          >
                                            {f.severity}
                                          </Badge>
                                          <span className="text-foreground/90 break-all">
                                            {f.filePath && (
                                              <span className="text-muted-foreground font-mono">
                                                {f.filePath}
                                                {f.line ? `:${f.line}` : ''}
                                                {' — '}
                                              </span>
                                            )}
                                            {f.message}
                                          </span>
                                        </div>
                                      ))}
                                      {mod.findings.length > 10 && (
                                        <p className="text-xs text-muted-foreground pl-2.5">
                                          ... and {mod.findings.length - 10} more
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Expanded but no detail */}
                    {isExpanded && !entry.detail && (
                      <div className="px-6 pb-4 pl-16">
                        <p className="text-sm text-muted-foreground">
                          {entry.scan.status === 'completed'
                            ? 'Module details unavailable for this scan.'
                            : `Scan status: ${entry.scan.status}`}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
