'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScoreGauge } from '@/components/score-gauge';
import { FindingsTable } from '@/components/findings-table';
import { TreemapViz } from '@/components/treemap-viz';
import { DepGraphViz } from '@/components/dep-graph-viz';
import { BusFactorHeatmap } from '@/components/bus-factor-heatmap';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

interface FindingData {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
  suggestion?: string | null;
  moduleId?: string;
}

interface ModuleData {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  state?: string;
  stateReason?: string | null;
  summary: string | null;
  metrics: Record<string, number> | null;
  findings: FindingData[];
}

function formatStateLabel(state: string | undefined): string {
  if (!state) return 'Completed';
  return state
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function ModulePage() {
  const params = useParams<{ id: string; moduleId: string }>();
  const { id, moduleId } = params;

  const [repo, setRepo] = React.useState<RepoData | null>(null);
  const [moduleData, setModuleData] = React.useState<ModuleData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        // Fetch repo info
        const reposRes = await fetch('/api/repos');
        if (!reposRes.ok) throw new Error('Failed to fetch repos');
        const allRepos: RepoData[] = await reposRes.json();
        const currentRepo = allRepos.find((r) => r.id === id);
        if (!currentRepo) {
          setError('Repository not found');
          return;
        }
        setRepo(currentRepo);

        if (!currentRepo.latestScan) {
          setError('No scan results available');
          return;
        }

        // Fetch scan details
        const scanRes = await fetch(`/api/scans/${currentRepo.latestScan.id}`);
        if (!scanRes.ok) throw new Error('Failed to fetch scan details');
        const scanData = await scanRes.json();

        // Find the specific module
        const mod = scanData.modules.find(
          (m: ModuleData) => m.moduleId === moduleId
        );
        if (!mod) {
          setError(`Module "${moduleId}" not found in scan results`);
          return;
        }

        // Attach moduleId to findings
        setModuleData({
          ...mod,
          findings: mod.findings.map((f: FindingData) => ({
            ...f,
            moduleId: mod.moduleId,
          })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id, moduleId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-6">
          <Skeleton className="h-32 w-32 rounded-full" />
          <div className="space-y-3 flex-1">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-6 w-48" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Link href={`/repo/${id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4" data-icon="inline-start" />
            Back to repo
          </Button>
        </Link>
        <Card>
          <CardContent>
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!moduleData) return null;

  const moduleName = moduleId
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const confidencePct = Math.round(moduleData.confidence * 100);
  const isScored = !moduleData.state || moduleData.state === 'completed';

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link href={`/repo/${id}`}>
        <Button variant="ghost" size="sm">
          <ArrowLeft className="size-4" data-icon="inline-start" />
          Back to {repo?.name ?? 'repo'}
        </Button>
      </Link>

      {/* Module header */}
      <div className="flex items-start gap-6">
        <ScoreGauge score={isScored ? moduleData.score : null} size={120} />
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">{moduleName}</h1>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{confidencePct}% confidence</Badge>
            <Badge variant={isScored ? 'outline' : 'secondary'}>
              {formatStateLabel(moduleData.state)}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {moduleData.findings.length} findings
            </span>
          </div>
          {moduleData.stateReason && (
            <p className="text-sm text-muted-foreground max-w-2xl">
              {moduleData.stateReason}
            </p>
          )}
          {moduleData.summary && (
            <p className="text-sm text-muted-foreground max-w-2xl">
              {moduleData.summary}
            </p>
          )}
        </div>
      </div>

      {/* Metrics */}
      {moduleData.metrics && Object.keys(moduleData.metrics).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.entries(moduleData.metrics).map(([key, value]) => (
                <div key={key} className="space-y-1">
                  <p className="text-xs text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}
                  </p>
                  <p className="text-lg font-semibold">
                    {typeof value === 'number' ? value.toLocaleString() : value}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Module-specific visualization */}
      {moduleId === 'complexity' && (
        <Card>
          <CardHeader>
            <CardTitle>Complexity Treemap</CardTitle>
          </CardHeader>
          <CardContent>
            <TreemapViz
              metrics={moduleData.metrics ?? {}}
              findings={moduleData.findings}
            />
          </CardContent>
        </Card>
      )}

      {moduleId === 'circular-deps' && (
        <Card>
          <CardHeader>
            <CardTitle>Dependency Graph</CardTitle>
          </CardHeader>
          <CardContent>
            <DepGraphViz findings={moduleData.findings} />
          </CardContent>
        </Card>
      )}

      {moduleId === 'git-health' && (
        <Card>
          <CardHeader>
            <CardTitle>Bus Factor Heatmap</CardTitle>
          </CardHeader>
          <CardContent>
            <BusFactorHeatmap
              metrics={moduleData.metrics ?? {}}
              findings={moduleData.findings}
            />
          </CardContent>
        </Card>
      )}

      {/* Findings Table */}
      {moduleData.findings.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Findings</h2>
          <FindingsTable findings={moduleData.findings} />
        </section>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No findings for this module. Everything looks good!
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
