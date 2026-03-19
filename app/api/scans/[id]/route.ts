import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings } from '@/lib/db/schema';

/**
 * GET /api/scans/[id] — Return a single scan with all module results and findings.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const scan = db.select().from(scans).where(eq(scans.id, id)).get();

    if (!scan) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    const results = db
      .select()
      .from(moduleResults)
      .where(eq(moduleResults.scanId, id))
      .all();

    const modules = results.map((result) => {
      const resultFindings = db
        .select()
        .from(findings)
        .where(eq(findings.moduleResultId, result.id))
        .all();

      return {
        id: result.id,
        moduleId: result.moduleId,
        score: result.score,
        confidence: result.confidence,
        summary: result.summary,
        metrics: result.metrics ? JSON.parse(result.metrics) : null,
        findings: resultFindings,
      };
    });

    return NextResponse.json({
      scan: {
        id: scan.id,
        repoId: scan.repoId,
        status: scan.status,
        overallScore: scan.overallScore,
        durationMs: scan.durationMs,
        createdAt: scan.createdAt,
      },
      modules,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
