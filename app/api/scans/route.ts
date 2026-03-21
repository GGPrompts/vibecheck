import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, scans, scanConfigs } from '@/lib/db/schema';
import { runScan } from '@/lib/modules/orchestrator';
import type { ScanConfig } from '@/lib/modules/orchestrator';
import '@/lib/modules/register-all';

/**
 * POST /api/scans — Trigger a new scan.
 * Body: { repoId: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repoId } = body as { repoId: string };

    if (!repoId || typeof repoId !== 'string') {
      return NextResponse.json(
        { error: 'repoId is required and must be a string' },
        { status: 400 }
      );
    }

    const repo = db.select().from(repos).where(eq(repos.id, repoId)).get();
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    // Look up scan config: try repo-specific first, then global (repoId IS NULL)
    let config: ScanConfig | undefined;
    const savedConfig =
      db.select().from(scanConfigs).where(eq(scanConfigs.repoId, repoId)).get() ??
      db.select().from(scanConfigs).limit(1).get();

    if (savedConfig) {
      config = {
        enabledModules: savedConfig.enabledModules
          ? JSON.parse(savedConfig.enabledModules)
          : undefined,
      };
    }

    // Create the scan record upfront so we can return the scanId immediately.
    // runScan creates it internally too, but we need the ID before starting.
    const scanId = nanoid();
    db.insert(scans).values({
      id: scanId,
      repoId,
      status: 'running',
      configSnapshot: JSON.stringify(config ?? {}),
    }).run();

    // Detach scan execution from the route handler's async context.
    // Without setTimeout, Next.js waits for the dangling promise before
    // sending the response, blocking the 202 for the entire scan duration.
    setTimeout(() => {
      runScan(repo.path, repoId, config, scanId).catch((err) => {
        console.error('Scan failed:', err);
      });
    }, 0);

    return NextResponse.json({ scanId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/scans — List recent scans across all repos (or filtered by repoId).
 * Query params:
 *   - repoId: filter scans to a specific repo
 *   - status: filter by scan status (e.g. "completed")
 * Returns up to 50 scans ordered by createdAt desc, with repo name.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const repoIdFilter = url.searchParams.get('repoId');
    const statusFilter = url.searchParams.get('status');

    const conditions = [];
    if (repoIdFilter) {
      conditions.push(eq(scans.repoId, repoIdFilter));
    }
    if (statusFilter) {
      conditions.push(eq(scans.status, statusFilter));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const recentScans = db
      .select({
        id: scans.id,
        repoId: scans.repoId,
        repoName: repos.name,
        status: scans.status,
        overallScore: scans.overallScore,
        durationMs: scans.durationMs,
        createdAt: scans.createdAt,
      })
      .from(scans)
      .leftJoin(repos, eq(scans.repoId, repos.id))
      .where(whereClause)
      .orderBy(desc(scans.createdAt))
      .limit(50)
      .all();

    return NextResponse.json(recentScans);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
