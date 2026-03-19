import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { eq, and, desc, ne } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings as findingsTable } from '@/lib/db/schema';
import { getEnabledModules, getAllModules } from './registry';
import { computeOverallScore } from './scoring';
import { readVibecheckRc, mergeWithRc } from '@/lib/config/vibecheckrc';
import { getProfileConfig } from '@/lib/config/profiles';
import { classifyFiles } from '@/lib/metadata/classifier';
import type { ModuleResult } from './types';
import type { RegisteredModule } from './types';

export interface ScanProgress {
  scanId: string;
  moduleId: string;
  status: 'running' | 'complete' | 'error';
  progress: number;
  message: string;
}

export class ScanEventEmitter extends EventEmitter {
  emitProgress(progress: ScanProgress): void {
    this.emit('progress', progress);
  }

  onProgress(listener: (progress: ScanProgress) => void): void {
    this.on('progress', listener);
  }

  offProgress(listener: (progress: ScanProgress) => void): void {
    this.off('progress', listener);
  }
}

/** Global event emitter for SSE consumption. */
export const scanEvents = new ScanEventEmitter();

export interface ScanConfig {
  enabledModules?: string[];
  weights?: Record<string, number>;
}

/**
 * Run a full scan: execute all enabled modules against the given repo,
 * save results to the database, compute the overall score, and return the scan ID.
 */
export async function runScan(
  repoPath: string,
  repoId: string,
  config?: ScanConfig
): Promise<string> {
  const scanId = nanoid();
  const startTime = Date.now();

  // Read per-repo .vibecheckrc and merge with incoming config
  const rc = readVibecheckRc(repoPath);
  if (rc) {
    // Apply profile as a base layer — explicit rc.modules/thresholds override profile defaults
    if (rc.profile) {
      const profileCfg = getProfileConfig(rc.profile);
      rc.modules = { ...profileCfg.modules, ...rc.modules };
      rc.thresholds = { ...profileCfg.thresholds, ...rc.thresholds };
    }
    config = mergeWithRc(config, rc);
  }

  // Create the scan record
  db.insert(scans).values({
    id: scanId,
    repoId,
    status: 'running',
    configSnapshot: config ? JSON.stringify(config) : null,
  }).run();

  let enabledModules = getEnabledModules(config?.enabledModules);

  // Handle .vibecheckrc disableModules (when no base enabledModules list exists)
  const disableModules = (config as ScanConfig & { disableModules?: string[] } | undefined)?.disableModules;
  if (disableModules && disableModules.length > 0) {
    const disableSet = new Set(disableModules);
    enabledModules = enabledModules.filter((m) => !disableSet.has(m.definition.id));
  }

  // Classify files by role for context-aware module scoring
  const fileRoles = classifyFiles(repoPath, rc ?? undefined);

  const resultSummaries: Array<{
    moduleId: string;
    score: number;
    confidence: number;
  }> = [];
  let moduleErrors = 0;

  for (const mod of enabledModules) {
    const { definition, runner } = mod;

    scanEvents.emitProgress({
      scanId,
      moduleId: definition.id,
      status: 'running',
      progress: 0,
      message: `Starting ${definition.name}...`,
    });

    try {
      const canRun = await runner.canRun(repoPath);
      if (!canRun) {
        scanEvents.emitProgress({
          scanId,
          moduleId: definition.id,
          status: 'complete',
          progress: 100,
          message: `${definition.name} skipped (not applicable)`,
        });
        continue;
      }

      const result: ModuleResult = await runner.run(repoPath, {
        onProgress: (pct, msg) => {
          scanEvents.emitProgress({
            scanId,
            moduleId: definition.id,
            status: 'running',
            progress: pct,
            message: msg,
          });
        },
        fileRoles,
      });

      // Save module result to DB
      const moduleResultId = nanoid();
      db.insert(moduleResults).values({
        id: moduleResultId,
        scanId,
        moduleId: definition.id,
        score: result.score,
        confidence: result.confidence,
        summary: result.summary,
        metrics: JSON.stringify(result.metrics),
      }).run();

      // Filter findings by ignore patterns from .vibecheckrc
      const ignorePatterns: string[] = (config as ScanConfig & { rc?: { ignore?: string[] } } | undefined)?.rc?.ignore ?? [];
      const filteredFindings = ignorePatterns.length > 0
        ? result.findings.filter((f) => {
            if (!f.filePath) return true;
            return !ignorePatterns.some((pattern) => {
              // Simple glob: "components/ui/**" matches "components/ui/sidebar.tsx"
              const prefix = pattern.replace(/\*\*$/, '').replace(/\*$/, '');
              return f.filePath!.startsWith(prefix);
            });
          })
        : result.findings;

      // Save findings to DB
      if (filteredFindings.length > 0) {
        for (const finding of filteredFindings) {
          db.insert(findingsTable).values({
            id: finding.id,
            moduleResultId,
            fingerprint: finding.fingerprint,
            severity: finding.severity,
            filePath: finding.filePath,
            line: finding.line ?? null,
            message: finding.message,
            category: finding.category,
            status: 'new',
          }).run();
        }
      }

      resultSummaries.push({
        moduleId: definition.id,
        score: result.score,
        confidence: result.confidence,
      });

      scanEvents.emitProgress({
        scanId,
        moduleId: definition.id,
        status: 'complete',
        progress: 100,
        message: `${definition.name} complete — score: ${result.score}`,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      scanEvents.emitProgress({
        scanId,
        moduleId: definition.id,
        status: 'error',
        progress: 0,
        message: `${definition.name} failed: ${errorMessage}`,
      });
      moduleErrors++;
    }
  }

  // ── Fingerprint-based status tracking ──
  await reconcileFindingStatuses(scanId, repoId);

  // Compute overall score
  const overallScore = computeOverallScore(resultSummaries, config?.weights);
  const durationMs = Date.now() - startTime;

  // Determine final status: 'completed' if all modules ran, 'partial' if some failed, 'failed' if all failed
  const totalModules = enabledModules.length;
  const finalStatus = moduleErrors === 0
    ? 'completed'
    : moduleErrors < totalModules
      ? 'completed'  // partial success still counts as completed, but we track errors
      : 'failed';

  // Update scan record
  db.update(scans)
    .set({
      status: finalStatus,
      overallScore,
      durationMs,
    })
    .where(eq(scans.id, scanId))
    .run();

  return scanId;
}

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
async function reconcileFindingStatuses(
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
    // No previous scan — all findings stay as 'new' (default)
    return;
  }

  const prevScan = previousScans[0];
  const prevFindings = loadFindingsForScan(prevScan.id);
  const prevFingerprints = new Set(prevFindings.map((f) => f.fingerprint));

  // Check 2 scans back for regression detection
  let twoBackFingerprints: Set<string> | null = null;
  let twoBackFixedFingerprints: Set<string> | null = null;

  if (previousScans.length >= 2) {
    const twoBackScan = previousScans[1];
    const twoBackFindings = loadFindingsForScan(twoBackScan.id);
    twoBackFingerprints = new Set(twoBackFindings.map((f) => f.fingerprint));

    // Fingerprints that were 'fixed' in the previous scan (existed 2 scans back
    // but not in the previous scan)
    twoBackFixedFingerprints = new Set<string>();
    for (const fp of twoBackFingerprints) {
      if (!prevFingerprints.has(fp)) {
        twoBackFixedFingerprints.add(fp);
      }
    }
    // Also include findings explicitly marked fixed in the previous scan
    for (const f of prevFindings) {
      if (f.status === 'fixed') {
        twoBackFixedFingerprints.add(f.fingerprint);
      }
    }
  }

  // Load current findings
  const currentFindings = loadFindingsForScan(currentScanId);
  const currentFingerprints = new Set(currentFindings.map((f) => f.fingerprint));

  // Update statuses for current findings
  for (const finding of currentFindings) {
    let newStatus: string;

    if (
      twoBackFixedFingerprints &&
      twoBackFixedFingerprints.has(finding.fingerprint)
    ) {
      // Was fixed in the previous scan but reappears now → regressed
      newStatus = 'regressed';
    } else if (prevFingerprints.has(finding.fingerprint)) {
      // Existed in previous scan → recurring
      newStatus = 'recurring';
    } else {
      // Not in previous scan → new
      newStatus = 'new';
    }

    if (newStatus !== finding.status) {
      db.update(findingsTable)
        .set({ status: newStatus })
        .where(eq(findingsTable.id, finding.id))
        .run();
    }
  }

  // Create 'fixed' records for previous findings not in the current scan
  // We need a moduleResultId to attach them to — use the first one from the current scan
  const currentModuleResults = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, currentScanId))
    .limit(1)
    .all();

  if (currentModuleResults.length > 0) {
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
}

/**
 * Run a fast scan using only static modules (skip AI modules).
 * Does NOT write to the database — designed for post-commit hooks.
 * Enforces a 30-second timeout per module.
 *
 * @returns scores per module and the overall weighted score.
 */
export async function runFastScan(
  repoPath: string
): Promise<{ scores: Record<string, number>; overall: number }> {
  const allModules = getAllModules();
  const staticModules: RegisteredModule[] = allModules.filter(
    (m) => m.definition.category === 'static'
  );

  const scores: Record<string, number> = {};
  const resultSummaries: Array<{
    moduleId: string;
    score: number;
    confidence: number;
  }> = [];

  const TIMEOUT_MS = 30_000;

  for (const mod of staticModules) {
    const { definition, runner } = mod;

    try {
      const canRun = await runner.canRun(repoPath);
      if (!canRun) continue;

      // Race the module against a timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const result: ModuleResult = await Promise.race([
        runner.run(repoPath, {
          signal: controller.signal,
          onProgress: () => {},
        }),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error(`Module ${definition.id} timed out after 30s`))
          );
        }),
      ]);

      clearTimeout(timeoutId);

      scores[definition.id] = result.score;
      resultSummaries.push({
        moduleId: definition.id,
        score: result.score,
        confidence: result.confidence,
      });
    } catch {
      // Skip modules that fail or timeout — don't block
      continue;
    }
  }

  const overall = computeOverallScore(resultSummaries);
  return { scores, overall };
}
