/**
 * vibecheck_health — get latest health scores for a repository.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { moduleResults } from '@/lib/db/schema';
import { requireRepoAndScan, jsonResponse } from './helpers.js';
import type { ToolResponse } from './helpers.js';

export const vibecheckHealthInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
};

export async function handleVibecheckHealth(args: {
  repo_path: string;
}): Promise<ToolResponse> {
  const { repo_path } = args;

  const result = requireRepoAndScan(repo_path);
  if ('error' in result) return result.error;

  const { repo, scan } = result;

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
    repo: repo.name,
    repo_path: repo.path,
    scan_id: scan.id,
    scanned_at: scan.createdAt,
    overall_score: scan.overallScore,
    modules: moduleScores,
  });
}
