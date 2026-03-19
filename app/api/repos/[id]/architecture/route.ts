import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos } from '@/lib/db/schema';
import { buildImportGraph } from '@/lib/visualizer/graph-builder';
import { analyzeArchitecture } from '@/lib/visualizer/architecture';
import { classifyFiles } from '@/lib/metadata/classifier';
import type { ArchitectureAnalysis } from '@/lib/visualizer/architecture';

// ---------------------------------------------------------------------------
// In-memory cache with TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: ArchitectureAnalysis;
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const archCache = new Map<string, CacheEntry>();

function getCached(repoId: string): ArchitectureAnalysis | null {
  const entry = archCache.get(repoId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    archCache.delete(repoId);
    return null;
  }
  return entry.data;
}

function setCache(repoId: string, data: ArchitectureAnalysis) {
  archCache.set(repoId, { data, createdAt: Date.now() });
}

// ---------------------------------------------------------------------------
// GET /api/repos/[id]/architecture
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
          analysis: cached,
          cached: true,
          repoId,
          repoPath: repo.path,
        });
      }
    }

    // Build the import graph
    const graph = buildImportGraph(repo.path);

    // Classify files for role-based layer assignment
    const fileRoles = classifyFiles(repo.path);

    // Run architecture analysis
    const analysis = analyzeArchitecture(graph, fileRoles);

    // Cache the result
    setCache(repoId, analysis);

    return NextResponse.json({
      analysis,
      cached: false,
      repoId,
      repoPath: repo.path,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
