import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { HealthSnapshot } from './snapshot';

const HEALTH_FILE = '.vibecheck/commit-health.jsonl';

/**
 * Read all snapshots from the JSONL file.
 */
function readAllSnapshots(repoPath: string): HealthSnapshot[] {
  const filePath = join(repoPath, HEALTH_FILE);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  const snapshots: HealthSnapshot[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      snapshots.push(JSON.parse(trimmed) as HealthSnapshot);
    } catch {
      // Skip malformed lines
      continue;
    }
  }
  return snapshots;
}

/**
 * Look up the health snapshot for a specific commit hash.
 * Returns the most recent snapshot matching that hash, or null if not found.
 */
export function getCommitHealth(repoPath: string, hash: string): HealthSnapshot | null {
  const snapshots = readAllSnapshots(repoPath);
  // Search from the end (most recent first)
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i].commit === hash || snapshots[i].commit.startsWith(hash)) {
      return snapshots[i];
    }
  }
  return null;
}

/**
 * Get the last N health snapshots, ordered from oldest to newest.
 * @param count Number of snapshots to return (default 20)
 */
export function getHealthTrend(repoPath: string, count: number = 20): HealthSnapshot[] {
  const snapshots = readAllSnapshots(repoPath);
  return snapshots.slice(-count);
}

/**
 * Quick delta check: returns current score, previous score, and the delta.
 * Returns null if there are fewer than 1 snapshot.
 */
export function getScoreDelta(
  repoPath: string
): { current: number; previous: number; delta: number } | null {
  const snapshots = readAllSnapshots(repoPath);
  if (snapshots.length === 0) return null;

  const current = snapshots[snapshots.length - 1];

  if (snapshots.length === 1) {
    return {
      current: current.overall,
      previous: current.overall,
      delta: 0,
    };
  }

  const previous = snapshots[snapshots.length - 2];
  return {
    current: current.overall,
    previous: previous.overall,
    delta: current.overall - previous.overall,
  };
}

/**
 * Find commits where the score dropped by more than the given threshold.
 * @param threshold Minimum score drop to flag (default 10 points)
 */
export function findRegressions(
  repoPath: string,
  threshold: number = 10
): HealthSnapshot[] {
  const snapshots = readAllSnapshots(repoPath);
  const regressions: HealthSnapshot[] = [];

  for (const snapshot of snapshots) {
    // delta is negative when score drops
    if (snapshot.delta < -threshold) {
      regressions.push(snapshot);
    }
  }

  return regressions;
}
