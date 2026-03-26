/**
 * vibecheck_health — get latest health scores for a repository.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { basename } from 'path';
import { db } from '@/lib/db/client';
import { repos, moduleResults } from '@/lib/db/schema';
import { getLatestScan, jsonResponse } from './helpers.js';
import type { ToolResponse } from './helpers.js';

export const vibecheckHealthInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
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

  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scan.id))
    .all();

  const moduleScores = results.map((r) => ({
    module: r.moduleId,
    score: r.score,
    confidence: r.confidence,
    summary: r.summary,
  }));

  return jsonResponse({
    repo: existing.name,
    repo_path: existing.path,
    scan_id: scan.id,
    scanned_at: scan.createdAt,
    overall_score: scan.overallScore,
    modules: moduleScores,
    status: 'ok',
  });
}
