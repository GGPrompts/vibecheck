import { NextResponse } from 'next/server';
import { like, eq, desc, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, scans, moduleResults } from '@/lib/db/schema';
import { fetchRepoMetadata } from '@/lib/github/metadata';

/**
 * GET /api/github/results/[owner]/[repo]
 *
 * Fetch GitHub metadata and look up scan results for a given owner/repo.
 * Returns metadata plus scan data if a completed scan exists.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const { owner, repo: repoName } = await params;

    // Fetch fresh metadata from GitHub
    const metadata = await fetchRepoMetadata(owner, repoName);

    // Look up repo in DB — search for path containing the owner/repo pattern
    const searchPattern = `%${owner}-${repoName}%`;
    const repoRow = db
      .select()
      .from(repos)
      .where(like(repos.path, searchPattern))
      .get();

    if (!repoRow) {
      return NextResponse.json({ metadata, scanned: false });
    }

    // Look for the latest completed scan
    const latestScan = db
      .select()
      .from(scans)
      .where(
        and(eq(scans.repoId, repoRow.id), eq(scans.status, 'completed')),
      )
      .orderBy(desc(scans.createdAt))
      .limit(1)
      .get();

    if (!latestScan) {
      // Repo exists but no completed scan yet (maybe still running)
      const runningScan = db
        .select()
        .from(scans)
        .where(
          and(eq(scans.repoId, repoRow.id), eq(scans.status, 'running')),
        )
        .limit(1)
        .get();

      return NextResponse.json({
        metadata,
        scanned: false,
        scanning: !!runningScan,
        scanId: runningScan?.id ?? null,
      });
    }

    // Load module results for the completed scan
    const modules = db
      .select({
        moduleId: moduleResults.moduleId,
        score: moduleResults.score,
        confidence: moduleResults.confidence,
        summary: moduleResults.summary,
      })
      .from(moduleResults)
      .where(eq(moduleResults.scanId, latestScan.id))
      .all();

    return NextResponse.json({
      metadata,
      scanned: true,
      scanId: latestScan.id,
      overallScore: latestScan.overallScore,
      modules,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
