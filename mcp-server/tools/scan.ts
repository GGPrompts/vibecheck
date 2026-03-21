/**
 * vibecheck_scan — trigger a full scan on a repository.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { existsSync } from 'fs';
import { db } from '@/lib/db/client';
import { scans, scanConfigs } from '@/lib/db/schema';
import { runScan } from '@/lib/modules/orchestrator';
import type { ScanConfig } from '@/lib/modules/orchestrator';
import { resolveRepo, textResponse, jsonResponse } from './helpers.js';
import type { ToolResponse } from './helpers.js';

// Ensure all scan modules are registered
import '@/lib/modules/register-all';

export const vibecheckScanInput = {
  repo_path: z.string().describe('Absolute path to the repository to scan'),
};

export async function handleVibecheckScan(args: {
  repo_path: string;
}): Promise<ToolResponse> {
  const { repo_path } = args;

  if (!existsSync(repo_path)) {
    return textResponse(`Error: path does not exist: ${repo_path}`);
  }

  const repo = resolveRepo(repo_path);

  // Load scan config if one exists
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

  try {
    const scanId = await runScan(repo.path, repo.id, config);
    const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();

    return jsonResponse({
      scan_id: scanId,
      repo: repo.name,
      status: scan?.status ?? 'unknown',
      overall_score: scan?.overallScore ?? null,
      duration_ms: scan?.durationMs ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResponse(`Scan failed: ${message}`);
  }
}
