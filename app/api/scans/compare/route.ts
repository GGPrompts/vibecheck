import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings } from '@/lib/db/schema';

interface FindingRow {
  id: string;
  moduleResultId: string | null;
  fingerprint: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

interface ModuleResultRow {
  id: string;
  scanId: string | null;
  moduleId: string;
  score: number;
  confidence: number;
  state: string;
  stateReason: string | null;
  summary: string | null;
  metrics: string | null;
}

interface EnrichedModule {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  state: string;
  stateReason: string | null;
  summary: string | null;
  metrics: Record<string, unknown> | null;
  findings: FindingRow[];
}

function loadScanWithModules(scanId: string) {
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan) return null;

  const results: ModuleResultRow[] = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scanId))
    .all();

  const modules: EnrichedModule[] = results.map((result) => {
    const resultFindings: FindingRow[] = db
      .select()
      .from(findings)
      .where(eq(findings.moduleResultId, result.id))
      .all();

    return {
      id: result.id,
      moduleId: result.moduleId,
      score: result.score,
      confidence: result.confidence,
      state: result.state,
      stateReason: result.stateReason,
      summary: result.summary,
      metrics: result.metrics ? JSON.parse(result.metrics) : null,
      findings: resultFindings,
    };
  });

  return { scan, modules };
}

/**
 * GET /api/scans/compare?a=SCAN_ID&b=SCAN_ID
 *
 * Returns a diff of two scans: score deltas per module,
 * new findings (in B but not A), fixed findings (in A but not B),
 * and unchanged findings (in both A and B by fingerprint).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const aId = searchParams.get('a');
    const bId = searchParams.get('b');

    if (!aId || !bId) {
      return NextResponse.json(
        { error: 'Both "a" and "b" scan ID query parameters are required' },
        { status: 400 }
      );
    }

    const scanA = loadScanWithModules(aId);
    if (!scanA) {
      return NextResponse.json(
        { error: `Scan A (${aId}) not found` },
        { status: 404 }
      );
    }

    const scanB = loadScanWithModules(bId);
    if (!scanB) {
      return NextResponse.json(
        { error: `Scan B (${bId}) not found` },
        { status: 404 }
      );
    }

    // Build module score deltas
    const allModuleIds = new Set<string>();
    for (const m of scanA.modules) allModuleIds.add(m.moduleId);
    for (const m of scanB.modules) allModuleIds.add(m.moduleId);

    const moduleDeltas = Array.from(allModuleIds)
      .sort()
      .map((moduleId) => {
        const modA = scanA.modules.find((m) => m.moduleId === moduleId);
        const modB = scanB.modules.find((m) => m.moduleId === moduleId);
        return {
          moduleId,
          scoreA: modA?.score ?? null,
          scoreB: modB?.score ?? null,
          stateA: modA?.state ?? null,
          stateB: modB?.state ?? null,
          delta:
            modA && modB ? modB.score - modA.score : null,
          summaryA: modA?.summary ?? null,
          summaryB: modB?.summary ?? null,
        };
      });

    // Overall score delta
    const overallDelta = {
      scoreA: scanA.scan.overallScore,
      scoreB: scanB.scan.overallScore,
      delta:
        scanA.scan.overallScore != null && scanB.scan.overallScore != null
          ? scanB.scan.overallScore - scanA.scan.overallScore
          : null,
    };

    // Build finding diffs by fingerprint
    const allFindingsA = scanA.modules.flatMap((m) =>
      m.findings.map((f) => ({ ...f, moduleId: m.moduleId }))
    );
    const allFindingsB = scanB.modules.flatMap((m) =>
      m.findings.map((f) => ({ ...f, moduleId: m.moduleId }))
    );

    const fingerprintsA = new Set(allFindingsA.map((f) => f.fingerprint));
    const fingerprintsB = new Set(allFindingsB.map((f) => f.fingerprint));

    const newFindings = allFindingsB.filter(
      (f) => !fingerprintsA.has(f.fingerprint)
    );
    const fixedFindings = allFindingsA.filter(
      (f) => !fingerprintsB.has(f.fingerprint)
    );
    const unchangedFindings = allFindingsB.filter((f) =>
      fingerprintsA.has(f.fingerprint)
    );

    return NextResponse.json({
      scanA: {
        id: scanA.scan.id,
        overallScore: scanA.scan.overallScore,
        createdAt: scanA.scan.createdAt,
        status: scanA.scan.status,
      },
      scanB: {
        id: scanB.scan.id,
        overallScore: scanB.scan.overallScore,
        createdAt: scanB.scan.createdAt,
        status: scanB.scan.status,
      },
      overallDelta,
      moduleDeltas,
      newFindings,
      fixedFindings,
      unchangedFindings,
      summary: {
        newCount: newFindings.length,
        fixedCount: fixedFindings.length,
        unchangedCount: unchangedFindings.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
