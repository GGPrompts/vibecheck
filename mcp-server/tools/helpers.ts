/**
 * Shared helpers for MCP tool handlers.
 */
import { eq, desc, and } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db/client';
import { repos, scans, moduleResults, findings as findingsTable } from '@/lib/db/schema';

/** Standard MCP tool response type. */
export type ToolResponse = { content: Array<{ type: 'text'; text: string }> };

/** Build a single-text MCP response. */
export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

/** Build a JSON MCP response. */
export function jsonResponse(data: unknown): ToolResponse {
  return textResponse(JSON.stringify(data, null, 2));
}

/**
 * Resolve a repo record from the database by path, creating it if needed.
 */
export function resolveRepo(repoPath: string): { id: string; name: string; path: string } {
  const existing = db
    .select()
    .from(repos)
    .where(eq(repos.path, repoPath))
    .get();

  if (existing) {
    return { id: existing.id, name: existing.name, path: existing.path };
  }

  // Auto-register the repo
  let name = basename(repoPath);
  try {
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        name = pkg.name;
      }
    }
  } catch {
    // Fall back to directory basename
  }

  const id = nanoid();
  db.insert(repos).values({ id, path: repoPath, name }).run();
  return { id, name, path: repoPath };
}

/**
 * Get the latest completed scan for a repo.
 */
export function getLatestScan(repoId: string) {
  return db
    .select()
    .from(scans)
    .where(and(eq(scans.repoId, repoId), eq(scans.status, 'completed')))
    .orderBy(desc(scans.createdAt))
    .limit(1)
    .get();
}

/**
 * Get the most recent completed scans for a repo, newest first.
 */
export function getCompletedScans(repoId: string, limit = 2) {
  return db
    .select()
    .from(scans)
    .where(and(eq(scans.repoId, repoId), eq(scans.status, 'completed')))
    .orderBy(desc(scans.createdAt))
    .limit(limit)
    .all();
}

export interface LoadedModuleResult {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  state: string;
  stateReason: string | null;
  summary: string | null;
  metrics: Record<string, unknown> | null;
  findings: Array<{
    id: string;
    fingerprint: string;
    severity: string;
    filePath: string | null;
    line: number | null;
    message: string;
    category: string;
    suggestion: string | null;
    status: string;
  }>;
}

/**
 * Load a scan and all associated module results/findings.
 */
export function loadScanBundle(scanId: string): { scan: NonNullable<ReturnType<typeof getLatestScan>>; modules: LoadedModuleResult[] } | null {
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan) return null;

  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scanId))
    .all();

  const modules = results.map((result) => {
    const rows = db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.moduleResultId, result.id))
      .all();

    return {
      id: result.id,
      moduleId: result.moduleId,
      score: result.score,
      confidence: result.confidence,
      state: result.state,
      stateReason: result.stateReason,
      summary: result.summary,
      metrics: result.metrics ? JSON.parse(result.metrics) : null,
      findings: rows.map((finding) => ({
        id: finding.id,
        fingerprint: finding.fingerprint,
        severity: finding.severity,
        filePath: finding.filePath,
        line: finding.line,
        message: finding.message,
        category: finding.category,
        suggestion: finding.suggestion,
        status: finding.status,
      })),
    };
  });

  return { scan, modules };
}

/**
 * Look up a repo by path and its latest scan; returns error response if not found.
 */
export function requireRepoAndScan(repoPath: string):
  | { error: ToolResponse }
  | { repo: { id: string; name: string; path: string }; scan: NonNullable<ReturnType<typeof getLatestScan>> } {
  const existing = db
    .select()
    .from(repos)
    .where(eq(repos.path, repoPath))
    .get();

  if (!existing) {
    return {
      error: textResponse(`No repo registered at ${repoPath}. Run vibecheck_scan first.`),
    };
  }

  const scan = getLatestScan(existing.id);
  if (!scan) {
    return {
      error: textResponse(`No completed scans found for ${existing.name}. Run vibecheck_scan first.`),
    };
  }

  return { repo: { id: existing.id, name: existing.name, path: existing.path }, scan };
}
