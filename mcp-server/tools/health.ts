/**
 * vibecheck_health — get latest health scores for a repository.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { basename } from 'path';
import { db } from '@/lib/db/client';
import { repos } from '@/lib/db/schema';
import { buildComparePayload, buildHealthSuccessPayload, modulePayload } from './health-contracts.js';
import { getLatestScan, getCompletedScans, loadScanBundle, requireRepoAndScan, jsonResponse } from './helpers.js';
import type { ToolResponse } from './helpers.js';

export const vibecheckHealthInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
};

export const vibecheckModuleInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  module_id: z.string().describe('Module ID to inspect'),
  scan_id: z.string().optional().describe('Specific scan ID (defaults to latest completed scan)'),
};

export const vibecheckCompareInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  base_scan_id: z.string().optional().describe('Older scan ID to compare from'),
  head_scan_id: z.string().optional().describe('Newer scan ID to compare to'),
  limit: z.number().int().min(1).max(50).optional().describe('Max number of regressions to return (default 10)'),
};

export async function handleVibecheckHealth(args: {
  repo_path: string;
}): Promise<ToolResponse> {
  const { repo_path } = args;

  // Look up the repo — it may not exist yet if no scan has been run
  const existing = db
    .select()
    .from(repos)
    .where(eq(repos.path, repo_path))
    .get();

  if (!existing) {
    // Return a structured "no data yet" response rather than an error string
    return jsonResponse({
      repo: basename(repo_path),
      repo_path,
      scan_id: null,
      scanned_at: null,
      overall_score: null,
      modules: [],
      status: 'no_scan',
      message: 'No scan has been run for this repository. Use vibecheck_scan to get health scores.',
    });
  }

  const scan = getLatestScan(existing.id);

  if (!scan) {
    // Repo is registered but no completed scan yet
    return jsonResponse({
      repo: existing.name,
      repo_path: existing.path,
      scan_id: null,
      scanned_at: null,
      overall_score: null,
      modules: [],
      status: 'no_scan',
      message: 'No completed scans found. Use vibecheck_scan to get health scores.',
    });
  }

  const bundle = loadScanBundle(scan.id);
  if (!bundle) {
    return jsonResponse({
      repo: existing.name,
      repo_path: existing.path,
      scan_id: scan.id,
      scanned_at: scan.createdAt,
      overall_score: scan.overallScore,
      modules: [],
      status: 'no_scan',
      message: 'Latest scan could not be loaded.',
    });
  }

  return jsonResponse(buildHealthSuccessPayload(existing, scan, bundle.modules));
}

export async function handleVibecheckModule(args: {
  repo_path: string;
  module_id: string;
  scan_id?: string;
}): Promise<ToolResponse> {
  const { repo_path, module_id, scan_id } = args;

  let targetScanId = scan_id;
  if (!targetScanId) {
    const result = requireRepoAndScan(repo_path);
    if ('error' in result) return result.error;
    targetScanId = result.scan.id;
  }

  const bundle = loadScanBundle(targetScanId);
  if (!bundle) {
    return jsonResponse({
      scan_id: targetScanId,
      module_id,
      status: 'not_found',
      message: 'Scan not found.',
    });
  }

  const moduleResult = bundle.modules.find((result) => result.moduleId === module_id);
  if (!moduleResult) {
    return jsonResponse({
      scan_id: targetScanId,
      module_id,
      status: 'not_found',
      message: `Module ${module_id} was not present in scan ${targetScanId}.`,
    });
  }

  return jsonResponse({
    scan_id: targetScanId,
    module: modulePayload(moduleResult),
  });
}

export async function handleVibecheckCompare(args: {
  repo_path: string;
  base_scan_id?: string;
  head_scan_id?: string;
  limit?: number;
}): Promise<ToolResponse> {
  const { repo_path, base_scan_id, head_scan_id, limit = 10 } = args;

  const repo = db.select().from(repos).where(eq(repos.path, repo_path)).get();
  if (!repo) {
    return jsonResponse({
      repo: basename(repo_path),
      repo_path,
      status: 'not_found',
      message: 'Repository is not registered yet. Run vibecheck_scan first.',
    });
  }

  const repoScans = getCompletedScans(repo.id, 50);
  if (repoScans.length < 2 && (!base_scan_id || !head_scan_id)) {
    return jsonResponse({
      repo: repo.name,
      repo_path,
      status: 'not_enough_scans',
      message: 'Need at least two completed scans to compare.',
    });
  }

  const head = head_scan_id
    ? loadScanBundle(head_scan_id)
    : loadScanBundle(repoScans[0].id);
  const base = base_scan_id
    ? loadScanBundle(base_scan_id)
    : loadScanBundle(repoScans[1]?.id ?? repoScans[0].id);

  if (!head || !base) {
    return jsonResponse({
      repo: repo.name,
      repo_path,
      status: 'not_found',
      message: 'One or both scans could not be loaded.',
    });
  }

  return jsonResponse(buildComparePayload(repo, base, head, limit));
}
