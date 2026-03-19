import { NextResponse } from 'next/server';
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

    // Fire and forget — runScan synchronously inserts the scan record (via
    // better-sqlite3 .run()) before its first await, so by the time the
    // returned promise is stored, the DB row already exists.
    const scanPromise = runScan(repo.path, repoId, config);

    // Query the DB for the scan that was just created synchronously
    const latestScan = db
      .select({ id: scans.id })
      .from(scans)
      .where(and(eq(scans.repoId, repoId), eq(scans.status, 'running')))
      .orderBy(desc(scans.createdAt))
      .limit(1)
      .get();

    // Let the scan run to completion in the background — log errors only
    scanPromise.catch((err) => {
      console.error('Scan failed:', err);
    });

    const scanId = latestScan?.id;
    if (!scanId) {
      return NextResponse.json(
        { error: 'Failed to start scan' },
        { status: 500 }
      );
    }

    return NextResponse.json({ scanId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/scans — List recent scans across all repos.
 * Returns up to 20 scans ordered by createdAt desc, with repo name.
 */
export async function GET() {
  try {
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
      .orderBy(desc(scans.createdAt))
      .limit(20)
      .all();

    return NextResponse.json(recentScans);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
