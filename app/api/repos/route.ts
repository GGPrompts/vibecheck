import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, scans, scanConfigs, moduleResults, findings } from '@/lib/db/schema';

/**
 * GET /api/repos — List all repos with their latest scan scores.
 */
export async function GET() {
  try {
    const allRepos = db.select().from(repos).all();

    const reposWithScores = allRepos.map((repo) => {
      const latestScan = db
        .select()
        .from(scans)
        .where(eq(scans.repoId, repo.id))
        .orderBy(desc(scans.createdAt))
        .limit(1)
        .get();

      return {
        ...repo,
        latestScan: latestScan
          ? {
              id: latestScan.id,
              status: latestScan.status,
              overallScore: latestScan.overallScore,
              createdAt: latestScan.createdAt,
            }
          : null,
      };
    });

    return NextResponse.json(reposWithScores);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/repos — Add a repo by path.
 * Body: { path: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { path: repoPath } = body as { path: string };

    if (!repoPath || typeof repoPath !== 'string') {
      return NextResponse.json(
        { error: 'path is required and must be a string' },
        { status: 400 }
      );
    }

    if (!existsSync(repoPath)) {
      return NextResponse.json(
        { error: 'Path does not exist on filesystem' },
        { status: 400 }
      );
    }

    // Try to extract name from package.json, otherwise use directory basename
    let name = basename(repoPath);
    try {
      const pkgPath = join(repoPath, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name && typeof pkg.name === 'string') {
          name = pkg.name;
        }
      }
    } catch {
      // Ignore errors reading package.json, fall back to basename
    }

    const id = nanoid();
    db.insert(repos)
      .values({ id, path: repoPath, name })
      .run();

    const created = db.select().from(repos).where(eq(repos.id, id)).get();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint')) {
      return NextResponse.json(
        { error: 'A repo with this path already exists' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/repos — Remove a repo and cascade delete all related records.
 * Body: { id: string }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { id } = body as { id: string };

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'id is required and must be a string' },
        { status: 400 }
      );
    }

    const repo = db.select().from(repos).where(eq(repos.id, id)).get();
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    // Cascade delete: findings → moduleResults → scans → scanConfigs → repo
    const repoScans = db
      .select({ id: scans.id })
      .from(scans)
      .where(eq(scans.repoId, id))
      .all();

    for (const scan of repoScans) {
      const results = db
        .select({ id: moduleResults.id })
        .from(moduleResults)
        .where(eq(moduleResults.scanId, scan.id))
        .all();

      for (const result of results) {
        db.delete(findings)
          .where(eq(findings.moduleResultId, result.id))
          .run();
      }

      db.delete(moduleResults).where(eq(moduleResults.scanId, scan.id)).run();
    }

    db.delete(scans).where(eq(scans.repoId, id)).run();
    db.delete(scanConfigs).where(eq(scanConfigs.repoId, id)).run();
    db.delete(repos).where(eq(repos.id, id)).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
