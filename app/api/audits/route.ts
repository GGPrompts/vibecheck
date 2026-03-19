import { NextResponse } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, audits, auditResults } from '@/lib/db/schema';
import { runAudit } from '@/lib/audit/runner';

/**
 * POST /api/audits — Trigger a new AI audit.
 * Body: { repoId: string, provider: 'claude-api'|'claude-cli'|'codex', modules?: string[] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repoId, provider, modules } = body as {
      repoId: string;
      provider: 'claude-api' | 'claude-cli' | 'codex';
      modules?: string[];
    };

    if (!repoId || typeof repoId !== 'string') {
      return NextResponse.json(
        { error: 'repoId is required and must be a string' },
        { status: 400 }
      );
    }

    const validProviders = ['claude-api', 'claude-cli', 'codex'] as const;
    if (!provider || !validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `provider must be one of: ${validProviders.join(', ')}` },
        { status: 400 }
      );
    }

    const repo = db.select().from(repos).where(eq(repos.id, repoId)).get();
    if (!repo) {
      return NextResponse.json({ error: 'Repo not found' }, { status: 404 });
    }

    // Fire and forget — runAudit synchronously inserts the audit record (via
    // better-sqlite3 .run()) before its first await, so by the time we query
    // the DB the row already exists.
    const auditPromise = runAudit(repo.path, repoId, { provider, modules });

    // Query the DB for the audit that was just created synchronously
    const latestAudit = db
      .select({ id: audits.id })
      .from(audits)
      .where(eq(audits.repoId, repoId))
      .orderBy(desc(audits.createdAt))
      .limit(1)
      .get();

    // Let the audit run to completion in the background — log errors only
    auditPromise.catch((err) => {
      console.error('Audit failed:', err);
    });

    const auditId = latestAudit?.id;
    if (!auditId) {
      return NextResponse.json(
        { error: 'Failed to start audit' },
        { status: 500 }
      );
    }

    return NextResponse.json({ auditId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/audits — List recent audits across all repos.
 * Returns up to 20 audits ordered by createdAt desc, with repo name.
 */
export async function GET() {
  try {
    const recentAudits = db
      .select({
        id: audits.id,
        repoId: audits.repoId,
        repoName: repos.name,
        provider: audits.provider,
        model: audits.model,
        status: audits.status,
        durationMs: audits.durationMs,
        createdAt: audits.createdAt,
      })
      .from(audits)
      .leftJoin(repos, eq(audits.repoId, repos.id))
      .orderBy(desc(audits.createdAt))
      .limit(20)
      .all();

    // Attach a summary of findings count per audit
    const enriched = recentAudits.map((audit) => {
      const results = db
        .select({ findings: auditResults.findings })
        .from(auditResults)
        .where(eq(auditResults.auditId, audit.id))
        .all();

      let totalFindings = 0;
      for (const r of results) {
        try {
          const parsed = JSON.parse(r.findings);
          if (Array.isArray(parsed)) {
            totalFindings += parsed.length;
          }
        } catch {
          // skip malformed
        }
      }

      return {
        ...audit,
        totalFindings,
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
