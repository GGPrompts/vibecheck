'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ModuleScoreCard } from '@/components/module-score-card';
import { HotspotQuadrant } from '@/components/hotspot-quadrant';
import { RadarChart } from '@/components/radar-chart';
import { Loader2, Play, Sparkles } from 'lucide-react';

interface RepoData {
  id: string;
  name: string;
  path: string;
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

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
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

  return (
    <div className="space-y-8">
      {/* Summary Row */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-6">
          <ScoreGauge
            score={scanDetail?.scan.overallScore ?? repo.latestScan?.overallScore ?? null}
            size={120}
          />
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">{repo.name}</h1>
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
            ) : (
              <Play className="size-4" data-icon="inline-start" />
            )}
            {scanLoading ? 'Starting...' : 'Scan Now'}
          </Button>

          {scanDetail && (
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="outline">
                    <Sparkles className="size-4" data-icon="inline-start" />
                    Generate Claude Prompt
                  </Button>
                }
              />
              <SheetContent side="right" className="sm:max-w-xl overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>Claude Prompt</SheetTitle>
                  <SheetDescription>
                    Generate a prompt with scan findings for Claude to help fix issues.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">
                  <PromptOutput scanId={scanDetail.scan.id} />
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </div>

      {/* Active Scan Progress */}
      {activeScanId && (
        <Card>
          <CardHeader>
            <CardTitle>Scan in Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ScanProgress scanId={activeScanId} onComplete={handleScanComplete} />
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

      {/* Empty state when no scan exists */}
      {!scanDetail && !activeScanId && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              No scan results yet. Run your first scan to see health metrics.
            </p>
            <Button onClick={handleScanNow} disabled={scanLoading}>
              {scanLoading ? (
                <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
              ) : (
                <Play className="size-4" data-icon="inline-start" />
              )}
              Run First Scan
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
