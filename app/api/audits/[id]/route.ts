import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { audits, auditResults } from '@/lib/db/schema';

/**
 * GET /api/audits/[id] — Return a single audit with all module results and parsed findings.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const audit = db.select().from(audits).where(eq(audits.id, id)).get();

    if (!audit) {
      return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
    }

    const results = db
      .select()
      .from(auditResults)
      .where(eq(auditResults.auditId, id))
      .all();

    const modules = results.map((result) => {
      let parsedFindings: unknown[] = [];
      try {
        const parsed = JSON.parse(result.findings);
        if (Array.isArray(parsed)) {
          parsedFindings = parsed;
        }
      } catch {
        // keep empty array
      }

      return {
        id: result.id,
        moduleId: result.moduleId,
        summary: result.summary,
        findings: parsedFindings,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
      };
    });

    return NextResponse.json({
      audit: {
        id: audit.id,
        repoId: audit.repoId,
        provider: audit.provider,
        model: audit.model,
        status: audit.status,
        durationMs: audit.durationMs,
        createdAt: audit.createdAt,
      },
      modules,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
