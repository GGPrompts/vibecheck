import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings as findingsTable } from '@/lib/db/schema';
import { getEnabledModules } from './registry';
import { computeOverallScore } from './scoring';
import type { ModuleResult } from './types';

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

  // Create the scan record
  db.insert(scans).values({
    id: scanId,
    repoId,
    status: 'running',
    configSnapshot: config ? JSON.stringify(config) : null,
  }).run();

  const enabledModules = getEnabledModules(config?.enabledModules);
  const resultSummaries: Array<{
    moduleId: string;
    score: number;
    confidence: number;
  }> = [];

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

      // Save findings to DB
      if (result.findings.length > 0) {
        for (const finding of result.findings) {
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
    }
  }

  // Compute overall score
  const overallScore = computeOverallScore(resultSummaries, config?.weights);
  const durationMs = Date.now() - startTime;

  // Update scan record
  db.update(scans)
    .set({
      status: 'completed',
      overallScore,
      durationMs,
    })
    .where(eq(scans.id, scanId))
    .run();

  return scanId;
}
