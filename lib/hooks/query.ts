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
 * Get the last N health snapshots, ordered from oldest to newest.
 * @param count Number of snapshots to return (default 20)
 */
export function getHealthTrend(repoPath: string, count: number = 20): HealthSnapshot[] {
  const snapshots = readAllSnapshots(repoPath);
  return snapshots.slice(-count);
}


