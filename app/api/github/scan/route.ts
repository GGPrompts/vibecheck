import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { parseGitHubRepo, cloneRepo } from '@/lib/github/cloner';
import { getCachedResult, setCachedResult } from '@/lib/github/cache';
import { fetchRepoMetadata } from '@/lib/github/metadata';
import { db } from '@/lib/db/client';
import { repos, scans } from '@/lib/db/schema';
import { runScan } from '@/lib/modules/orchestrator';
import '@/lib/modules/register-all';

/** Static modules only — no AI modules for GitHub explorer scans. */
const STATIC_MODULES = [
  'security',
  'dependencies',
  'complexity',
  'dead-code',
  'circular-deps',
  'git-health',
  'test-coverage',
  'ast-rules',
];

/**
 * POST /api/github/scan
 *
 * Clone a GitHub repo, register it in the DB, and kick off a static-only scan.
 * Returns immediately with { scanId, repoId, owner, repo }.
 *
 * Body: { repoUrl: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repoUrl } = body as { repoUrl: string };

    if (!repoUrl || typeof repoUrl !== 'string') {
      return NextResponse.json(
        { error: 'repoUrl is required and must be a string' },
        { status: 400 },
      );
    }

    // Parse owner/repo from URL
    const { owner, repo } = parseGitHubRepo(repoUrl);

    // Clone the repo (shallow) to get the current SHA
    const clone = await cloneRepo(repoUrl);

    // Check cache — if we already scanned this SHA, return cached result
    const cached = getCachedResult(owner, repo, clone.sha);
    if (cached) {
      clone.cleanup();
      return NextResponse.json({
        scanId: cached.scanId,
        repoId: cached.repoId,
        owner,
        repo,
        cached: true,
      });
    }

    // Register repo in DB
    const repoId = nanoid();
    const githubUrl = `https://github.com/${owner}/${repo}`;
    const metadata = JSON.stringify({ mode: 'evaluating', github: githubUrl, sha: clone.sha });

    db.insert(repos)
      .values({
        id: repoId,
        path: clone.path,
        name: `${owner}/${repo}`,
        metadata,
      })
      .run();

    // Pre-create scan record so we can return the scanId immediately
    const scanId = nanoid();
    db.insert(scans).values({
      id: scanId,
      repoId,
      status: 'running',
      configSnapshot: JSON.stringify({ enabledModules: STATIC_MODULES }),
    }).run();

    // Detach scan from route handler so Next.js sends 202 immediately
    setTimeout(() => {
      runScan(clone.path, repoId, { enabledModules: STATIC_MODULES }, scanId)
        .then(async (completedScanId) => {
          try {
            const meta = await fetchRepoMetadata(owner, repo);
            setCachedResult(owner, repo, clone.sha, {
              scanId: completedScanId,
              repoId,
              metadata: meta,
              scannedAt: new Date().toISOString(),
            });
          } catch {
            // Metadata fetch failure is non-fatal for caching
          }
        })
        .catch((err) => {
          console.error(`GitHub scan failed for ${owner}/${repo}:`, err);
        })
        .finally(() => {
          clone.cleanup();
        });
    }, 0);

    return NextResponse.json(
      { scanId, repoId, owner, repo, cached: false },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
