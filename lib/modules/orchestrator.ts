import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings as findingsTable } from '@/lib/db/schema';
import { getEnabledModules, getAllModules } from './registry';
import { computeOverallScore } from './scoring';
import { readVibecheckRc, mergeWithRc } from '@/lib/config/vibecheckrc';
import { getProfileConfig } from '@/lib/config/profiles';
import { readSettings } from '@/lib/config/settings';
import { autoDetect } from '@/lib/config/auto-detect';
import { classifyFiles } from '@/lib/metadata/classifier';
import { detectLanguages } from '@/lib/metadata/language-detector';
import { getAllowedModulesForLanguages } from './language-filter';
import { reconcileFindingStatuses } from './finding-reconciler';
import type { AutoDetectResult } from '@/lib/config/auto-detect';
import type { ModuleResult } from './types';
import type { RegisteredModule } from './types';

export interface ScanProgress {
  scanId: string;
  moduleId: string;
  status: 'running' | 'complete' | 'error';
  progress: number;
  message: string;
}

class ScanEventEmitter extends EventEmitter {
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

/** Global event emitter for SSE consumption. Survives HMR in dev mode. */
const globalForScan = globalThis as typeof globalThis & { __scanEvents?: ScanEventEmitter };
export const scanEvents = globalForScan.__scanEvents ??= new ScanEventEmitter();

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
  config?: ScanConfig,
  existingScanId?: string
): Promise<string> {
  const scanId = existingScanId ?? nanoid();
  const startTime = Date.now();

  // ── 0. Auto-detect repo characteristics (lowest-priority config layer) ──
  const autoDetected = autoDetect(repoPath);

  // Read per-repo .vibecheckrc and merge with incoming config
  const rc = readVibecheckRc(repoPath);

  // Determine the active profile with full priority chain:
  //   .vibecheckrc > global config.json > auto-detected > default 'team'
  const globalSettings = readSettings();
  const activeProfile =
    rc?.profile ??
    globalSettings.profile ??
    autoDetected.configOverlay.profile ??
    'team';

  // Apply profile as a base layer -- explicit rc.modules/thresholds override profile defaults.
  // Auto-detected thresholds are the lowest layer: auto-detect -> profile -> rc -> explicit.
  const profileCfg = getProfileConfig(activeProfile);
  if (rc) {
    rc.modules = { ...profileCfg.modules, ...rc.modules };
    rc.thresholds = {
      ...autoDetected.configOverlay.thresholds,
      ...profileCfg.thresholds,
      ...rc.thresholds,
    };
    rc.profile = activeProfile;
    config = mergeWithRc(config, rc);
  } else {
    // No .vibecheckrc -- apply auto-detect + profile directly
    config = mergeWithRc(config, {
      modules: profileCfg.modules,
      thresholds: {
        ...autoDetected.configOverlay.thresholds,
        ...profileCfg.thresholds,
      },
    });
  }

  // Detect repo languages for module filtering
  const repoLanguages = detectLanguages(repoPath);
  const allowedByLanguage = getAllowedModulesForLanguages(repoLanguages);

  // Collect modules explicitly enabled by .vibecheckrc (these bypass language filtering)
  const rcExplicitEnables = new Set<string>();
  if (rc?.modules) {
    for (const [id, on] of Object.entries(rc.modules)) {
      if (on) rcExplicitEnables.add(id);
    }
  }

  // Store language + auto-detect info in the config snapshot
  const configWithLanguages = {
    ...config,
    detectedLanguages: repoLanguages,
    autoDetected: {
      framework: autoDetected.detectedFramework,
      suggestedProfile: autoDetected.suggestedProfile,
      knipEntryPoints: autoDetected.knipEntryPoints,
    },
  };

  // Create the scan record (skip if caller pre-created it)
  if (!existingScanId) {
    db.insert(scans).values({
      id: scanId,
      repoId,
      status: 'running',
      configSnapshot: JSON.stringify(configWithLanguages),
    }).run();
  }

  let enabledModules = getEnabledModules(config?.enabledModules);

  // Filter modules by detected language (before rc disable overrides).
  // Modules explicitly enabled via .vibecheckrc bypass this filter.
  enabledModules = enabledModules.filter(
    (m) => allowedByLanguage.has(m.definition.id) || rcExplicitEnables.has(m.definition.id)
  );

  // Handle .vibecheckrc disableModules (when no base enabledModules list exists)
  const disableModules = (config as ScanConfig & { disableModules?: string[] } | undefined)?.disableModules;
  if (disableModules && disableModules.length > 0) {
    const disableSet = new Set(disableModules);
    enabledModules = enabledModules.filter((m) => !disableSet.has(m.definition.id));
  }

  // Classify files by role for context-aware module scoring
  const fileRoles = classifyFiles(repoPath, rc ?? undefined);

  // Filter findings by ignore patterns from .vibecheckrc
  const ignorePatterns: string[] = (config as ScanConfig & { rc?: { ignore?: string[] } } | undefined)?.rc?.ignore ?? [];

  // Execute modules and collect results
  const { resultSummaries, moduleErrors } = await executeModules(
    enabledModules, repoPath, scanId, fileRoles, ignorePatterns, autoDetected,
  );

  // ── Fingerprint-based status tracking ──
  await reconcileFindingStatuses(scanId, repoId);

  // Compute overall score and finalize scan
  finalizeScan(scanId, enabledModules.length, resultSummaries, moduleErrors, startTime, config);

  return scanId;
}

// ── Module execution helpers ──

interface ResultSummary {
  moduleId: string;
  score: number;
  confidence: number;
}

/**
 * Execute all enabled modules and save their results to the database.
 */
async function executeModules(
  enabledModules: RegisteredModule[],
  repoPath: string,
  scanId: string,
  fileRoles: Map<string, string[]>,
  ignorePatterns: string[],
  autoDetected: AutoDetectResult,
): Promise<{ resultSummaries: ResultSummary[]; moduleErrors: number }> {
  const resultSummaries: ResultSummary[] = [];
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
        autoDetect: {
          knipEntryPoints: autoDetected.knipEntryPoints,
          knipIgnorePatterns: autoDetected.knipIgnorePatterns,
          deadCodeExemptRoles: autoDetected.deadCodeExemptRoles,
        },
      });

      saveModuleResult(scanId, definition.id, result, ignorePatterns);

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

  return { resultSummaries, moduleErrors };
}

/**
 * Save a single module result (with filtered findings) to the database.
 */
function saveModuleResult(
  scanId: string,
  moduleId: string,
  result: ModuleResult,
  ignorePatterns: string[],
): void {
  const moduleResultId = nanoid();
  db.insert(moduleResults).values({
    id: moduleResultId,
    scanId,
    moduleId,
    score: result.score,
    confidence: result.confidence,
    summary: result.summary,
    metrics: JSON.stringify(result.metrics),
  }).run();

  const filteredFindings = ignorePatterns.length > 0
    ? result.findings.filter((f) => {
        if (!f.filePath) return true;
        return !ignorePatterns.some((pattern) => {
          const prefix = pattern.replace(/\*\*$/, '').replace(/\*$/, '');
          return f.filePath!.startsWith(prefix);
        });
      })
    : result.findings;

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
}

/**
 * Compute overall score and update the scan record as completed/failed.
 */
function finalizeScan(
  scanId: string,
  totalModules: number,
  resultSummaries: ResultSummary[],
  moduleErrors: number,
  startTime: number,
  config?: ScanConfig,
): void {
  const overallScore = computeOverallScore(resultSummaries, config?.weights);
  const durationMs = Date.now() - startTime;

  const finalStatus = moduleErrors === 0
    ? 'completed'
    : moduleErrors < totalModules
      ? 'completed'  // partial success still counts as completed, but we track errors
      : 'failed';

  db.update(scans)
    .set({
      status: finalStatus,
      overallScore,
      durationMs,
    })
    .where(eq(scans.id, scanId))
    .run();
}

/**
 * Run a fast scan using only static modules (skip AI modules).
 * Does NOT write to the database -- designed for post-commit hooks.
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
      // Skip modules that fail or timeout -- don't block
      continue;
    }
  }

  const overall = computeOverallScore(resultSummaries);
  return { scores, overall };
}
