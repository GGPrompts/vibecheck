import { EventEmitter } from 'events';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, scanConfigs } from '@/lib/db/schema';
import { runScan } from './orchestrator';
import type { ScanConfig } from './orchestrator';

export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null; // repo name currently being scanned
  results: Array<{ repoId: string; repoName: string; scanId?: string; error?: string }>;
}

type BatchEventCallback = (progress: BatchProgress) => void;

class BatchEventEmitter extends EventEmitter {
  emitProgress(batchId: string, progress: BatchProgress): void {
    this.emit(`progress:${batchId}`, progress);
  }

  onProgress(batchId: string, listener: (progress: BatchProgress) => void): void {
    this.on(`progress:${batchId}`, listener);
  }

  offProgress(batchId: string, listener: (progress: BatchProgress) => void): void {
    this.off(`progress:${batchId}`, listener);
  }

  emitDone(batchId: string): void {
    this.emit(`done:${batchId}`);
  }

  onDone(batchId: string, listener: () => void): void {
    this.on(`done:${batchId}`, listener);
  }

  offDone(batchId: string, listener: () => void): void {
    this.off(`done:${batchId}`, listener);
  }

  /** Clean up all listeners for a given batch. */
  cleanup(batchId: string): void {
    this.removeAllListeners(`progress:${batchId}`);
    this.removeAllListeners(`done:${batchId}`);
  }
}

/** Global event emitter for batch SSE consumption. */
export const batchEvents = new BatchEventEmitter();

/** Track active batch IDs so we can prevent duplicate batch runs. */
const activeBatches = new Set<string>();

/**
 * Run a batch scan across multiple repos sequentially.
 *
 * If `repoIds` is `'all'`, fetches every repo from the database.
 * Scans run one at a time to avoid overwhelming the system.
 * Progress events are emitted via both the optional callback and the global `batchEvents` emitter.
 */
export async function runBatchScan(
  repoIds: string[] | 'all',
  opts?: { enableAi?: boolean; onProgress?: BatchEventCallback; batchId?: string }
): Promise<BatchProgress> {
  const batchId = opts?.batchId ?? nanoid();

  // Resolve repo list
  let repoList: Array<{ id: string; name: string; path: string }>;

  if (repoIds === 'all') {
    repoList = db.select({ id: repos.id, name: repos.name, path: repos.path }).from(repos).all();
  } else {
    repoList = [];
    for (const rid of repoIds) {
      const repo = db
        .select({ id: repos.id, name: repos.name, path: repos.path })
        .from(repos)
        .where(eq(repos.id, rid))
        .get();
      if (repo) {
        repoList.push(repo);
      }
    }
  }

  const progress: BatchProgress = {
    total: repoList.length,
    completed: 0,
    failed: 0,
    current: null,
    results: [],
  };

  if (repoList.length === 0) {
    batchEvents.emitProgress(batchId, progress);
    batchEvents.emitDone(batchId);
    return progress;
  }

  activeBatches.add(batchId);

  function emitUpdate() {
    opts?.onProgress?.(progress);
    batchEvents.emitProgress(batchId, { ...progress, results: [...progress.results] });
  }

  // Run scans sequentially
  for (const repo of repoList) {
    if (!activeBatches.has(batchId)) {
      // Batch was cancelled
      break;
    }

    progress.current = repo.name;
    emitUpdate();

    try {
      // Look up scan config for this repo
      let config: ScanConfig | undefined;
      const savedConfig = db
        .select()
        .from(scanConfigs)
        .where(eq(scanConfigs.repoId, repo.id))
        .get();

      if (savedConfig) {
        config = {
          enabledModules: savedConfig.enabledModules
            ? JSON.parse(savedConfig.enabledModules)
            : undefined,
        };
      }

      const scanId = await runScan(repo.path, repo.id, config);

      progress.completed += 1;
      progress.results.push({ repoId: repo.id, repoName: repo.name, scanId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      progress.failed += 1;
      progress.completed += 1;
      progress.results.push({ repoId: repo.id, repoName: repo.name, error: errorMessage });
    }

    progress.current = null;
    emitUpdate();
  }

  activeBatches.delete(batchId);
  batchEvents.emitDone(batchId);

  return progress;
}

/** Cancel an active batch scan. The current repo scan will finish, but no further repos will be scanned. */
export function cancelBatch(batchId: string): boolean {
  if (activeBatches.has(batchId)) {
    activeBatches.delete(batchId);
    return true;
  }
  return false;
}
