'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import type { SerializedGraph } from 'graphology-types';
import type { FileHealthMap } from '@/lib/visualizer/file-health';
import type { ArchitectureAnalysis } from '@/lib/visualizer/architecture';

// Dynamic import of GraphRenderer since it uses Sigma (WebGL/canvas)
const GraphRenderer = React.lazy(() =>
  import('@/components/visualizer/graph-renderer').then((mod) => ({
    default: mod.GraphRenderer,
  })),
);

interface GraphApiResponse {
  graph: SerializedGraph;
  cached: boolean;
  repoId: string;
  repoPath: string;
}

interface ArchitectureApiResponse {
  analysis: ArchitectureAnalysis;
  cached: boolean;
  repoId: string;
  repoPath: string;
}

export default function MapPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [graphData, setGraphData] = React.useState<SerializedGraph | null>(null);
  const [healthMap, setHealthMap] = React.useState<FileHealthMap>({});
  const [architecture, setArchitecture] = React.useState<ArchitectureAnalysis | null>(null);
  const [githubUrl, setGithubUrl] = React.useState<string | null>(null);
  const [defaultBranch, setDefaultBranch] = React.useState<string>('main');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const fetchData = React.useCallback(
    async (refresh = false) => {
      try {
        if (refresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const refreshParam = refresh ? '?refresh=true' : '';

        // Fetch all 4 APIs in parallel
        const [graphRes, healthRes, archRes, reposRes] = await Promise.allSettled([
          fetch(`/api/repos/${id}/graph${refreshParam}`),
          fetch(`/api/repos/${id}/file-health`),
          fetch(`/api/repos/${id}/architecture${refreshParam}`),
          fetch('/api/repos'),
        ]);

        // Process graph (required)
        if (graphRes.status === 'rejected') {
          throw new Error('Failed to fetch graph data');
        }
        if (!graphRes.value.ok) {
          const errData = await graphRes.value.json().catch(() => ({}));
          throw new Error(
            (errData as { error?: string }).error ?? `Graph API returned ${graphRes.value.status}`,
          );
        }
        const graphJson: GraphApiResponse = await graphRes.value.json();
        setGraphData(graphJson.graph);

        // Process file health (optional — degrade gracefully)
        if (healthRes.status === 'fulfilled' && healthRes.value.ok) {
          const healthJson: FileHealthMap = await healthRes.value.json();
          setHealthMap(healthJson);
        } else {
          setHealthMap({});
        }

        // Process architecture (optional — degrade gracefully)
        if (archRes.status === 'fulfilled' && archRes.value.ok) {
          const archJson: ArchitectureApiResponse = await archRes.value.json();
          setArchitecture(archJson.analysis);
        } else {
          setArchitecture(null);
        }

        // Extract GitHub URL from repo metadata (optional)
        if (reposRes.status === 'fulfilled' && reposRes.value.ok) {
          try {
            const allRepos = await reposRes.value.json();
            const repo = allRepos.find((r: { id: string }) => r.id === id);
            if (repo?.metadata) {
              const meta = typeof repo.metadata === 'string' ? JSON.parse(repo.metadata) : repo.metadata;
              if (meta?.github) setGithubUrl(meta.github);
              if (meta?.defaultBranch) setDefaultBranch(meta.defaultBranch);
            }
          } catch {
            // Non-critical — GitHub links just won't appear
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id],
  );

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 3rem)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Link href={`/repo/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" data-icon="inline-start" />
              Back
            </Button>
          </Link>
          <h1 className="text-lg font-semibold">Architecture Map</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : (
            <RefreshCw className="size-4" data-icon="inline-start" />
          )}
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* Main content area */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background z-20">
            <Skeleton className="h-8 w-48" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Building import graph...
            </div>
            <Skeleton className="h-4 w-64" />
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background z-20">
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 max-w-md text-center">
              <p className="text-sm font-medium text-destructive mb-2">
                Failed to load architecture map
              </p>
              <p className="text-xs text-muted-foreground mb-4">{error}</p>
              <Button variant="outline" size="sm" onClick={() => fetchData()}>
                Try Again
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && graphData && (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Initializing renderer...
                </div>
              </div>
            }
          >
            <GraphRenderer
              serializedGraph={graphData}
              healthMap={healthMap}
              architecture={architecture}
              repoId={id}
              githubUrl={githubUrl}
              defaultBranch={defaultBranch}
            />
          </React.Suspense>
        )}
      </div>
    </div>
  );
}
