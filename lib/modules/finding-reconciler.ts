import { nanoid } from 'nanoid';
import { eq, and, desc, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings as findingsTable } from '@/lib/db/schema';

// ── Internal helpers for fingerprint reconciliation ──

interface FingerprintRecord {
  id: string;
  fingerprint: string;
  moduleResultId: string | null;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

/**
 * Load all findings for a given scan by joining through moduleResults.
 */
function loadFindingsForScan(targetScanId: string): FingerprintRecord[] {
  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, targetScanId))
    .all();

  const allFindings: FingerprintRecord[] = [];
  for (const mr of results) {
    const rows = db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.moduleResultId, mr.id))
      .all();
    allFindings.push(...rows);
  }
  return allFindings;
}

/**
 * After all modules have run for the current scan, compare fingerprints
 * against previous scans to set finding statuses:
 *   - new: fingerprint not in previous scan
 *   - recurring: fingerprint present in previous scan
 *   - fixed: fingerprint in previous scan but not current (create a record)
 *   - regressed: was fixed in previous scan but reappears now
 */
export async function reconcileFindingStatuses(
  currentScanId: string,
  repoId: string
): Promise<void> {
  // Find the most recent completed scan for this repo (before the current one)
  const previousScans = db
    .select()
    .from(scans)
    .where(
      and(
        eq(scans.repoId, repoId),
        eq(scans.status, 'completed'),
        ne(scans.id, currentScanId)
      )
    )
    .orderBy(desc(scans.createdAt))
    .limit(2)
    .all();

  if (previousScans.length === 0) {
    // No previous scan -- all findings stay as 'new' (default)
    return;
  }

  const prevScan = previousScans[0];
  const prevFindings = loadFindingsForScan(prevScan.id);
  const prevFingerprints = new Set(prevFindings.map((f) => f.fingerprint));

  // Check 2 scans back for regression detection
  const twoBackFixedFingerprints = buildTwoBackFixedSet(
    previousScans,
    prevFingerprints,
    prevFindings,
  );

  // Load current findings
  const currentFindings = loadFindingsForScan(currentScanId);
  const currentFingerprints = new Set(currentFindings.map((f) => f.fingerprint));

  // Update statuses for current findings
  updateCurrentFindingStatuses(
    currentFindings,
    prevFingerprints,
    twoBackFixedFingerprints,
  );

  // Create 'fixed' records for previous findings not in the current scan
  createFixedRecords(currentScanId, currentFingerprints, prevFindings);
}

/**
 * Build the set of fingerprints that were 'fixed' in the previous scan
 * (existed 2 scans back but not in the previous scan, or explicitly marked fixed).
 */
function buildTwoBackFixedSet(
  previousScans: Array<{ id: string }>,
  prevFingerprints: Set<string>,
  prevFindings: FingerprintRecord[],
): Set<string> | null {
  if (previousScans.length < 2) return null;

  const twoBackScan = previousScans[1];
  const twoBackFindings = loadFindingsForScan(twoBackScan.id);
  const twoBackFingerprints = new Set(twoBackFindings.map((f) => f.fingerprint));

  const fixedFingerprints = new Set<string>();
  for (const fp of twoBackFingerprints) {
    if (!prevFingerprints.has(fp)) {
      fixedFingerprints.add(fp);
    }
  }
  // Also include findings explicitly marked fixed in the previous scan
  for (const f of prevFindings) {
    if (f.status === 'fixed') {
      fixedFingerprints.add(f.fingerprint);
    }
  }

  return fixedFingerprints;
}

/**
 * Update status for each current finding based on previous scan data.
 */
function updateCurrentFindingStatuses(
  currentFindings: FingerprintRecord[],
  prevFingerprints: Set<string>,
  twoBackFixedFingerprints: Set<string> | null,
): void {
  for (const finding of currentFindings) {
    let newStatus: string;

    if (
      twoBackFixedFingerprints &&
      twoBackFixedFingerprints.has(finding.fingerprint)
    ) {
      newStatus = 'regressed';
    } else if (prevFingerprints.has(finding.fingerprint)) {
      newStatus = 'recurring';
    } else {
      newStatus = 'new';
    }

    if (newStatus !== finding.status) {
      db.update(findingsTable)
        .set({ status: newStatus })
        .where(eq(findingsTable.id, finding.id))
        .run();
    }
  }
}

/**
 * Create 'fixed' records for previous findings not present in the current scan.
 */
function createFixedRecords(
  currentScanId: string,
  currentFingerprints: Set<string>,
  prevFindings: FingerprintRecord[],
): void {
  const currentModuleResults = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, currentScanId))
    .limit(1)
    .all();

  if (currentModuleResults.length === 0) return;

  const attachResultId = currentModuleResults[0].id;

  for (const prevFinding of prevFindings) {
    // Skip findings that were already 'fixed' in the previous scan
    if (prevFinding.status === 'fixed') continue;

    if (!currentFingerprints.has(prevFinding.fingerprint)) {
      db.insert(findingsTable)
        .values({
          id: nanoid(),
          moduleResultId: attachResultId,
          fingerprint: prevFinding.fingerprint,
          severity: prevFinding.severity,
          filePath: prevFinding.filePath,
          line: prevFinding.line,
          message: prevFinding.message,
          category: prevFinding.category,
          status: 'fixed',
        })
        .run();
    }
  }
}
