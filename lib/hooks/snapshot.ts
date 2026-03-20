import { execSync } from 'child_process';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

export interface HealthSnapshot {
  commit: string;
  timestamp: string;
  scores: Record<string, number>;
  overall: number;
  delta: number;
  moduleCount: number;
}

const HEALTH_FILE = '.vibecheck/commit-health.jsonl';

/**
 * Get the path to the commit-health.jsonl file for a repo.
 */
function getHealthFilePath(repoPath: string): string {
  return join(repoPath, HEALTH_FILE);
}

/**
 * Read the last snapshot from the JSONL file for delta computation.
 */
function getLastSnapshot(repoPath: string): HealthSnapshot | null {
  const filePath = getHealthFilePath(repoPath);
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return null;

  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      return JSON.parse(line) as HealthSnapshot;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Get the current commit hash for the repo.
 */
function getCurrentCommit(repoPath: string): string {
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/**
 * Take a health snapshot for the current commit.
 * Runs only static modules (skips AI), enforces a 30-second timeout,
 * and appends the result to .vibecheck/commit-health.jsonl.
 */
async function takeSnapshot(repoPath: string): Promise<HealthSnapshot> {
  // Import here to avoid circular dependency issues and ensure modules are registered
  const { runFastScan } = await import('@/lib/modules/orchestrator');
  await import('@/lib/modules/register-all');

  const commit = getCurrentCommit(repoPath);
  const { scores, overall } = await runFastScan(repoPath);

  // Compute delta from previous snapshot
  const previous = getLastSnapshot(repoPath);
  const delta = previous ? overall - previous.overall : 0;

  const snapshot: HealthSnapshot = {
    commit,
    timestamp: new Date().toISOString(),
    scores,
    overall,
    delta,
    moduleCount: Object.keys(scores).length,
  };

  // Ensure .vibecheck directory exists
  const vibecheckDir = join(repoPath, '.vibecheck');
  if (!existsSync(vibecheckDir)) {
    mkdirSync(vibecheckDir, { recursive: true });
  }

  // Append snapshot as a single JSON line
  const filePath = getHealthFilePath(repoPath);
  appendFileSync(filePath, JSON.stringify(snapshot) + '\n', 'utf-8');

  return snapshot;
}

/**
 * CLI entry point: run as `node snapshot.js <repoPath>`.
 * Designed to be called from the git post-commit hook.
 * Must NOT block — errors are logged silently.
 */
async function main() {
  const repoPath = process.argv[2];
  if (!repoPath) {
    process.exit(0);
  }

  try {
    await takeSnapshot(repoPath);
  } catch (err) {
    // Silent failure — never block git commit
    if (process.env.VIBECHECK_DEBUG) {
      console.error('[vibecheck] snapshot error:', err);
    }
  }
}

// Run if invoked directly
if (require.main === module) {
  main().catch(() => process.exit(0));
}
