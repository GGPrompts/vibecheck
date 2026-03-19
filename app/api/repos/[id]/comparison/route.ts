import { NextResponse } from 'next/server';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  scans,
  moduleResults,
  findings,
  audits,
  auditResults,
} from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanFindingRow {
  id: string;
  fingerprint: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

interface ScanModuleData {
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  findings: ScanFindingRow[];
}

interface AuditFindingParsed {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
}

interface AuditModuleData {
  moduleId: string;
  summary: string;
  findings: AuditFindingParsed[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute a similarity score (0-1) between a scan finding and an audit finding
 * based on file path overlap and message similarity.
 */
function findingSimilarity(
  scanFinding: ScanFindingRow,
  auditFinding: AuditFindingParsed,
): number {
  let score = 0;

  // File path match — strongest signal
  if (scanFinding.filePath && auditFinding.file) {
    const scanPath = scanFinding.filePath.toLowerCase();
    const auditPath = auditFinding.file.toLowerCase();
    if (scanPath === auditPath) {
      score += 0.5;
    } else if (
      scanPath.endsWith(auditPath) ||
      auditPath.endsWith(scanPath)
    ) {
      score += 0.35;
    } else {
      // Check if filenames match (last segment)
      const scanFile = scanPath.split('/').pop() ?? '';
      const auditFile = auditPath.split('/').pop() ?? '';
      if (scanFile && auditFile && scanFile === auditFile) {
        score += 0.25;
      }
    }
  }

  // Line proximity (if both have lines and same file matched)
  if (
    score > 0 &&
    scanFinding.line != null &&
    auditFinding.line != null
  ) {
    const lineDiff = Math.abs(scanFinding.line - auditFinding.line);
    if (lineDiff === 0) score += 0.15;
    else if (lineDiff <= 5) score += 0.1;
    else if (lineDiff <= 20) score += 0.05;
  }

  // Message similarity — simple word overlap
  const scanWords = new Set(
    scanFinding.message
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
  const auditWords = new Set(
    auditFinding.message
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );

  if (scanWords.size > 0 && auditWords.size > 0) {
    let overlap = 0;
    for (const word of scanWords) {
      if (auditWords.has(word)) overlap++;
    }
    const overlapRatio =
      overlap / Math.min(scanWords.size, auditWords.size);
    score += overlapRatio * 0.3;
  }

  // Severity match bonus
  if (
    scanFinding.severity.toLowerCase() ===
    auditFinding.severity.toLowerCase()
  ) {
    score += 0.05;
  }

  return Math.min(score, 1);
}

// Threshold for considering two findings as matching
const SIMILARITY_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/repos/[id]/comparison
 *
 * Loads the latest completed scan AND latest completed audit for the repo,
 * then produces a per-module comparison and a finding diff grouped into:
 *   - bothFlagged:  matched by file path + message similarity
 *   - scanOnly:     scan found it, audit did not (possible false positive)
 *   - auditOnly:    audit found it, scan missed it (AI insight)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: repoId } = await params;

    // ---- Load latest completed scan ----
    const latestScan = db
      .select()
      .from(scans)
      .where(and(eq(scans.repoId, repoId), eq(scans.status, 'completed')))
      .orderBy(desc(scans.createdAt))
      .limit(1)
      .get();

    // ---- Load latest completed audit ----
    const latestAudit = db
      .select()
      .from(audits)
      .where(
        and(eq(audits.repoId, repoId), eq(audits.status, 'completed')),
      )
      .orderBy(desc(audits.createdAt))
      .limit(1)
      .get();

    if (!latestScan && !latestAudit) {
      return NextResponse.json(
        {
          error:
            'No completed scan or audit found for this repository. Run a scan and an audit first.',
        },
        { status: 404 },
      );
    }

    // ---- Load scan modules & findings ----
    let scanModules: ScanModuleData[] = [];
    if (latestScan) {
      const results = db
        .select()
        .from(moduleResults)
        .where(eq(moduleResults.scanId, latestScan.id))
        .all();

      scanModules = results.map((result) => {
        const resultFindings = db
          .select()
          .from(findings)
          .where(eq(findings.moduleResultId, result.id))
          .all();

        return {
          moduleId: result.moduleId,
          score: result.score,
          confidence: result.confidence,
          summary: result.summary,
          findings: resultFindings,
        };
      });
    }

    // ---- Load audit modules & findings ----
    let auditModules: AuditModuleData[] = [];
    if (latestAudit) {
      const results = db
        .select()
        .from(auditResults)
        .where(eq(auditResults.auditId, latestAudit.id))
        .all();

      auditModules = results.map((result) => {
        let parsedFindings: AuditFindingParsed[] = [];
        try {
          const parsed = JSON.parse(result.findings);
          if (Array.isArray(parsed)) {
            parsedFindings = parsed;
          }
        } catch {
          // keep empty
        }

        return {
          moduleId: result.moduleId,
          summary: result.summary,
          findings: parsedFindings,
        };
      });
    }

    // ---- Per-module comparison ----
    const allModuleIds = new Set<string>();
    for (const m of scanModules) allModuleIds.add(m.moduleId);
    for (const m of auditModules) allModuleIds.add(m.moduleId);

    const moduleComparisons = Array.from(allModuleIds)
      .sort()
      .map((moduleId) => {
        const scanMod = scanModules.find((m) => m.moduleId === moduleId);
        const auditMod = auditModules.find((m) => m.moduleId === moduleId);

        return {
          moduleId,
          hasScan: !!scanMod,
          hasAudit: !!auditMod,
          scanScore: scanMod?.score ?? null,
          scanConfidence: scanMod?.confidence ?? null,
          scanSummary: scanMod?.summary ?? null,
          scanFindingCount: scanMod?.findings.length ?? 0,
          auditSummary: auditMod?.summary ?? null,
          auditFindingCount: auditMod?.findings.length ?? 0,
        };
      });

    // ---- Finding diff (cross-module matching) ----
    const allScanFindings = scanModules.flatMap((m) =>
      m.findings.map((f) => ({ ...f, moduleId: m.moduleId })),
    );
    const allAuditFindings = auditModules.flatMap((m) =>
      m.findings.map((f) => ({ ...f, moduleId: m.moduleId })),
    );

    // Track which findings have been matched
    const matchedScanIds = new Set<string>();
    const matchedAuditIndices = new Set<number>();

    interface MatchedPair {
      similarity: number;
      scanFinding: (typeof allScanFindings)[0];
      auditFinding: (typeof allAuditFindings)[0];
    }

    // Build all candidate pairs, then greedily match best first
    const candidates: MatchedPair[] = [];
    for (const sf of allScanFindings) {
      for (let ai = 0; ai < allAuditFindings.length; ai++) {
        const af = allAuditFindings[ai];
        const sim = findingSimilarity(sf, af);
        if (sim >= SIMILARITY_THRESHOLD) {
          candidates.push({
            similarity: sim,
            scanFinding: sf,
            auditFinding: af,
          });
        }
      }
    }

    // Sort by similarity descending for greedy matching
    candidates.sort((a, b) => b.similarity - a.similarity);

    const bothFlagged: Array<{
      similarity: number;
      scan: {
        severity: string;
        filePath: string | null;
        line: number | null;
        message: string;
        category: string;
        moduleId: string;
      };
      audit: {
        severity: string;
        file: string;
        line?: number;
        message: string;
        category: string;
        moduleId: string;
      };
    }> = [];

    for (const candidate of candidates) {
      const scanId = candidate.scanFinding.id;
      const auditIdx = allAuditFindings.indexOf(candidate.auditFinding);

      if (matchedScanIds.has(scanId) || matchedAuditIndices.has(auditIdx)) {
        continue;
      }

      matchedScanIds.add(scanId);
      matchedAuditIndices.add(auditIdx);

      bothFlagged.push({
        similarity: Math.round(candidate.similarity * 100) / 100,
        scan: {
          severity: candidate.scanFinding.severity,
          filePath: candidate.scanFinding.filePath,
          line: candidate.scanFinding.line,
          message: candidate.scanFinding.message,
          category: candidate.scanFinding.category,
          moduleId: candidate.scanFinding.moduleId,
        },
        audit: {
          severity: candidate.auditFinding.severity,
          file: candidate.auditFinding.file,
          line: candidate.auditFinding.line,
          message: candidate.auditFinding.message,
          category: candidate.auditFinding.category,
          moduleId: candidate.auditFinding.moduleId,
        },
      });
    }

    const scanOnly = allScanFindings
      .filter((f) => !matchedScanIds.has(f.id))
      .map((f) => ({
        severity: f.severity,
        filePath: f.filePath,
        line: f.line,
        message: f.message,
        category: f.category,
        moduleId: f.moduleId,
      }));

    const auditOnly = allAuditFindings
      .filter((_, i) => !matchedAuditIndices.has(i))
      .map((f) => ({
        severity: f.severity,
        file: f.file,
        line: f.line,
        message: f.message,
        category: f.category,
        moduleId: f.moduleId,
      }));

    return NextResponse.json({
      scan: latestScan
        ? {
            id: latestScan.id,
            status: latestScan.status,
            overallScore: latestScan.overallScore,
            createdAt: latestScan.createdAt,
          }
        : null,
      audit: latestAudit
        ? {
            id: latestAudit.id,
            provider: latestAudit.provider,
            model: latestAudit.model,
            status: latestAudit.status,
            createdAt: latestAudit.createdAt,
          }
        : null,
      moduleComparisons,
      findingDiff: {
        bothFlagged,
        scanOnly,
        auditOnly,
      },
      summary: {
        bothFlaggedCount: bothFlagged.length,
        scanOnlyCount: scanOnly.length,
        auditOnlyCount: auditOnly.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
