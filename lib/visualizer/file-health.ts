import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileHealthData {
  health: number;
  color: 'red' | 'yellow' | 'green';
  findingCount: number;
  severityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  dominantModule: string | null;
}

export type FileHealthMap = Record<string, FileHealthData>;

// ---------------------------------------------------------------------------
// Severity weights (deducted from a base health of 100)
// ---------------------------------------------------------------------------

const SEVERITY_PENALTY: Record<string, number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
  info: 0,
};

// ---------------------------------------------------------------------------
// Color bucket thresholds
// ---------------------------------------------------------------------------

function colorBucket(health: number): 'red' | 'yellow' | 'green' {
  if (health <= 40) return 'red';
  if (health <= 70) return 'yellow';
  return 'green';
}

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregate per-file health scores from scan findings.
 *
 * Uses the latest completed scan for the given repo, or a specific scan if
 * `scanId` is provided.
 */
export function aggregateFileHealth(
  repoId: string,
  scanId?: string,
): FileHealthMap {
  // Resolve which scan to use
  const scan = scanId
    ? db
        .select()
        .from(scans)
        .where(and(eq(scans.id, scanId), eq(scans.repoId, repoId)))
        .get()
    : db
        .select()
        .from(scans)
        .where(and(eq(scans.repoId, repoId), eq(scans.status, 'completed')))
        .orderBy(desc(scans.createdAt))
        .limit(1)
        .get();

  if (!scan) {
    return {};
  }

  // Load all module results for this scan
  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scan.id))
    .all();

  if (results.length === 0) {
    return {};
  }

  // Build a moduleResultId -> moduleId lookup
  const moduleById = new Map<string, string>();
  for (const r of results) {
    moduleById.set(r.id, r.moduleId);
  }

  // Load all findings for these module results
  const allFindings: Array<{
    severity: string;
    filePath: string | null;
    moduleResultId: string | null;
  }> = [];

  for (const r of results) {
    const resultFindings = db
      .select({
        severity: findings.severity,
        filePath: findings.filePath,
        moduleResultId: findings.moduleResultId,
      })
      .from(findings)
      .where(eq(findings.moduleResultId, r.id))
      .all();
    allFindings.push(...resultFindings);
  }

  // Group findings by filePath
  const grouped = new Map<
    string,
    Array<{ severity: string; moduleId: string }>
  >();

  for (const f of allFindings) {
    if (!f.filePath) continue;
    const key = f.filePath;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push({
      severity: f.severity.toLowerCase(),
      moduleId: moduleById.get(f.moduleResultId ?? '') ?? 'unknown',
    });
  }

  // Build the health map
  const healthMap: FileHealthMap = {};

  for (const [filePath, fileFindings] of grouped) {
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const moduleCounts = new Map<string, number>();

    for (const f of fileFindings) {
      // Count severities
      if (f.severity in severityCounts) {
        severityCounts[f.severity as keyof typeof severityCounts]++;
      }

      // Count modules
      moduleCounts.set(f.moduleId, (moduleCounts.get(f.moduleId) ?? 0) + 1);
    }

    // Calculate health score
    let health = 100;
    for (const f of fileFindings) {
      health -= SEVERITY_PENALTY[f.severity] ?? 0;
    }
    health = Math.max(0, Math.min(100, health));

    // Determine dominant module
    let dominantModule: string | null = null;
    let maxCount = 0;
    for (const [moduleId, count] of moduleCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantModule = moduleId;
      }
    }

    healthMap[filePath] = {
      health,
      color: colorBucket(health),
      findingCount: fileFindings.length,
      severityCounts,
      dominantModule,
    };
  }

  return healthMap;
}
