import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos } from '@/lib/db/schema';
import { buildImportGraph } from '@/lib/visualizer/graph-builder';
import type { SerializedGraph } from 'graphology-types';

// ---------------------------------------------------------------------------
// In-memory cache with TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: SerializedGraph;
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const graphCache = new Map<string, CacheEntry>();

function getCached(repoId: string): SerializedGraph | null {
  const entry = graphCache.get(repoId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    graphCache.delete(repoId);
    return null;
  }
  return entry.data;
}

function setCache(repoId: string, data: SerializedGraph) {
  graphCache.set(repoId, { data, createdAt: Date.now() });
}

// ---------------------------------------------------------------------------
// GET /api/repos/[id]/graph
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: repoId } = await params;

    // Look up repo
    const repo = db.select().from(repos).where(eq(repos.id, repoId)).get();
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    // Check for refresh query param
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    // Serve from cache unless refresh requested
    if (!forceRefresh) {
      const cached = getCached(repoId);
      if (cached) {
        return NextResponse.json({
          graph: cached,
          cached: true,
          repoId,
          repoPath: repo.path,
        });
      }
    }

    // Build the import graph
    const graph = buildImportGraph(repo.path);

    // Cache the result
    setCache(repoId, graph);

    return NextResponse.json({
      graph,
      cached: false,
      repoId,
      repoPath: repo.path,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
