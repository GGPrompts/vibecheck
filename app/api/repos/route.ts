import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, scans, scanConfigs, moduleResults, findings } from '@/lib/db/schema';
import { detectWorkspaces } from '@/lib/monorepo/detector';

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

      // Parse mode from metadata JSON field
      let mode: 'maintaining' | 'evaluating' = 'maintaining';
      if (repo.metadata) {
        try {
          const meta = JSON.parse(repo.metadata);
          if (meta.mode === 'evaluating') mode = 'evaluating';
        } catch {
          // Ignore invalid JSON in metadata
        }
      }

      return {
        ...repo,
        mode,
        active: !!repo.active,
        parentRepoId: repo.parentRepoId ?? null,
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
 * Body: { path: string, mode?: 'maintaining' | 'evaluating' }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { path: repoPath, mode, active } = body as {
      path: string;
      mode?: 'maintaining' | 'evaluating';
      active?: boolean;
    };

    if (!repoPath || typeof repoPath !== 'string') {
      return NextResponse.json(
        { error: 'path is required and must be a string' },
        { status: 400 }
      );
    }

    if (mode && mode !== 'maintaining' && mode !== 'evaluating') {
      return NextResponse.json(
        { error: 'mode must be "maintaining" or "evaluating"' },
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
    const metadata = JSON.stringify({ mode: mode ?? 'maintaining' });
    const activeValue = active === false ? 0 : 1;
    db.insert(repos)
      .values({ id, path: repoPath, name, metadata, active: activeValue })
      .run();

    const created = db.select().from(repos).where(eq(repos.id, id)).get();

    // Detect monorepo workspaces and auto-register them as child repos
    const workspaces = detectWorkspaces(repoPath);
    const childRepos: typeof created[] = [];
    for (const ws of workspaces) {
      try {
        const childId = nanoid();
        const childMeta = JSON.stringify({ mode: mode ?? 'maintaining' });
        db.insert(repos)
          .values({
            id: childId,
            path: ws.path,
            name: ws.name,
            metadata: childMeta,
            parentRepoId: id,
          })
          .run();
        const child = db.select().from(repos).where(eq(repos.id, childId)).get();
        if (child) childRepos.push(child);
      } catch {
        // Skip workspaces that already exist (UNIQUE constraint on path)
      }
    }

    return NextResponse.json(
      { ...created, children: childRepos },
      { status: 201 },
    );
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
 * PATCH /api/repos — Toggle active status for a repo.
 * Body: { repoId: string, active: boolean }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { repoId, active } = body as { repoId: string; active: boolean };

    if (!repoId || typeof repoId !== 'string') {
      return NextResponse.json(
        { error: 'repoId is required and must be a string' },
        { status: 400 }
      );
    }

    if (typeof active !== 'boolean') {
      return NextResponse.json(
        { error: 'active is required and must be a boolean' },
        { status: 400 }
      );
    }

    const repo = db.select().from(repos).where(eq(repos.id, repoId)).get();
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    db.update(repos)
      .set({ active: active ? 1 : 0 })
      .where(eq(repos.id, repoId))
      .run();

    const updated = db.select().from(repos).where(eq(repos.id, repoId)).get();
    return NextResponse.json({ ...updated, active: !!updated!.active });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
