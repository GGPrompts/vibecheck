/**
 * Simple config-based scheduled scan support.
 *
 * Uses setInterval to periodically trigger batch scans via the existing
 * batch-orchestrator. This only runs while the Next.js dev server is running.
 *
 * ## Limitations
 * - Scheduling only works while the Next.js process is alive (dev or production).
 * - There is no persistence of schedule state across restarts — call `startScheduler()`
 *   on server startup if you want scans to resume automatically.
 * - For production cron-based scheduling, use an external cron job or task runner.
 */

import { runBatchScan } from '@/lib/modules/batch-orchestrator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduleConfig {
  /** Whether scheduling is enabled. */
  enabled: boolean;
  /** Interval between scans in hours. Minimum 1 hour. */
  intervalHours: number;
  /** Which repos to scan. Use 'all' for every registered repo. */
  repoIds: string[] | 'all';
  /** If true, only run static analysis (no AI modules). */
  staticOnly: boolean;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let activeTimer: ReturnType<typeof setInterval> | null = null;
let currentConfig: ScheduleConfig | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function tick() {
  if (isRunning) {
    console.log('[scheduler] Skipping tick — previous scan still running');
    return;
  }

  if (!currentConfig || !currentConfig.enabled) {
    return;
  }

  isRunning = true;
  const startTime = new Date();
  console.log(`[scheduler] Starting scheduled scan at ${startTime.toISOString()}`);

  try {
    const result = await runBatchScan(currentConfig.repoIds, {
      enableAi: !currentConfig.staticOnly,
    });

    lastRunAt = new Date();
    console.log(
      `[scheduler] Scan complete: ${result.completed}/${result.total} repos scanned, ${result.failed} failed`
    );
  } catch (error) {
    console.error('[scheduler] Scheduled scan failed:', error);
  } finally {
    isRunning = false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the scheduler with the given configuration.
 *
 * If the scheduler is already running, it will be stopped and restarted
 * with the new configuration.
 */
export function startScheduler(config: ScheduleConfig): void {
  // Stop existing scheduler if running
  stopScheduler();

  if (!config.enabled) {
    console.log('[scheduler] Scheduler disabled in config — not starting');
    return;
  }

  const intervalMs = Math.max(config.intervalHours, 1) * 60 * 60 * 1000;
  currentConfig = { ...config };

  console.log(
    `[scheduler] Starting scheduler: every ${config.intervalHours}h, ` +
      `repos: ${config.repoIds === 'all' ? 'all' : config.repoIds.length}, ` +
      `staticOnly: ${config.staticOnly}`
  );

  // Run immediately on start, then at interval
  tick();
  activeTimer = setInterval(tick, intervalMs);
}

/**
 * Stop the scheduler. Any currently running scan will finish, but no new
 * scans will be triggered.
 */
export function stopScheduler(): void {
  if (activeTimer !== null) {
    clearInterval(activeTimer);
    activeTimer = null;
    console.log('[scheduler] Scheduler stopped');
  }
  currentConfig = null;
}

/**
 * Get the current scheduler status.
 */
export function getSchedulerStatus(): {
  active: boolean;
  config: ScheduleConfig | null;
  isRunning: boolean;
  lastRunAt: Date | null;
} {
  return {
    active: activeTimer !== null,
    config: currentConfig ? { ...currentConfig } : null,
    isRunning,
    lastRunAt,
  };
}
