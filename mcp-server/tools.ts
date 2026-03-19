/**
 * MCP tool definitions for vibecheck.
 *
 * Each tool is defined with its input schema (using zod) and handler.
 * The handlers reuse existing lib/ code: orchestrator for scanning,
 * prompt-generator for prompts, and drizzle db for queries.
 */
import { z } from 'zod';
import { eq, desc, and, like } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db/client';
import {
  repos,
  scans,
  moduleResults,
  findings,
  scanConfigs,
} from '@/lib/db/schema';
import { runScan } from '@/lib/modules/orchestrator';
import type { ScanConfig } from '@/lib/modules/orchestrator';
import { generatePrompt } from '@/lib/prompt-generator/generator';

// Ensure all scan modules are registered
import '@/lib/modules/register-all';

// ── Tool input schemas ──────────────────────────────────────────────────

export const vibecheckScanInput = {
  repo_path: z.string().describe('Absolute path to the repository to scan'),
};

export const vibecheckHealthInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
};

export const vibecheckPromptInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  scan_id: z
    .string()
    .optional()
    .describe('Specific scan ID to generate prompt from (defaults to latest completed scan)'),
};

export const vibecheckFindingsInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low', 'info'])
    .optional()
    .describe('Filter findings by severity'),
  module: z.string().optional().describe('Filter findings by module ID'),
  status: z
    .enum(['new', 'recurring', 'fixed', 'regressed'])
    .optional()
    .describe('Filter findings by status'),
  scan_id: z
    .string()
    .optional()
    .describe('Specific scan ID (defaults to latest completed scan)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max number of findings to return (default 50)'),
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve a repo record from the database by path, creating it if needed.
 */
function resolveRepo(repoPath: string): { id: string; name: string; path: string } {
  // Look up existing repo by path
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
function getLatestScan(repoId: string) {
  return db
    .select()
    .from(scans)
    .where(and(eq(scans.repoId, repoId), eq(scans.status, 'completed')))
    .orderBy(desc(scans.createdAt))
    .limit(1)
    .get();
}

// ── Tool handlers ───────────────────────────────────────────────────────

/**
 * vibecheck_scan — trigger a full scan on a repository.
 */
export async function handleVibecheckScan(args: {
  repo_path: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { repo_path } = args;

  if (!existsSync(repo_path)) {
    return {
      content: [{ type: 'text', text: `Error: path does not exist: ${repo_path}` }],
    };
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

    // Load the completed scan for the summary
    const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              scan_id: scanId,
              repo: repo.name,
              status: scan?.status ?? 'unknown',
              overall_score: scan?.overallScore ?? null,
              duration_ms: scan?.durationMs ?? null,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Scan failed: ${message}` }],
    };
  }
}

/**
 * vibecheck_health — get latest health scores for a repository.
 */
export async function handleVibecheckHealth(args: {
  repo_path: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { repo_path } = args;

  const existing = db
    .select()
    .from(repos)
    .where(eq(repos.path, repo_path))
    .get();

  if (!existing) {
    return {
      content: [
        {
          type: 'text',
          text: `No repo registered at ${repo_path}. Run vibecheck_scan first.`,
        },
      ],
    };
  }

  const scan = getLatestScan(existing.id);
  if (!scan) {
    return {
      content: [
        {
          type: 'text',
          text: `No completed scans found for ${existing.name}. Run vibecheck_scan first.`,
        },
      ],
    };
  }

  // Load per-module scores
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

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            repo: existing.name,
            repo_path: existing.path,
            scan_id: scan.id,
            scanned_at: scan.createdAt,
            overall_score: scan.overallScore,
            modules: moduleScores,
          },
          null,
          2
        ),
      },
    ],
  };
}

/**
 * vibecheck_prompt — generate a Claude-optimized prompt from scan findings.
 */
export async function handleVibecheckPrompt(args: {
  repo_path: string;
  scan_id?: string;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { repo_path, scan_id } = args;

  let targetScanId = scan_id;

  if (!targetScanId) {
    const existing = db
      .select()
      .from(repos)
      .where(eq(repos.path, repo_path))
      .get();

    if (!existing) {
      return {
        content: [
          {
            type: 'text',
            text: `No repo registered at ${repo_path}. Run vibecheck_scan first.`,
          },
        ],
      };
    }

    const scan = getLatestScan(existing.id);
    if (!scan) {
      return {
        content: [
          {
            type: 'text',
            text: `No completed scans found for ${existing.name}. Run vibecheck_scan first.`,
          },
        ],
      };
    }
    targetScanId = scan.id;
  }

  try {
    const result = await generatePrompt(targetScanId);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              scan_id: targetScanId,
              estimated_tokens: result.estimated_tokens,
              prompt: result.prompt,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Prompt generation failed: ${message}` }],
    };
  }
}

/**
 * vibecheck_findings — list findings with optional filters.
 */
export async function handleVibecheckFindings(args: {
  repo_path: string;
  severity?: string;
  module?: string;
  status?: string;
  scan_id?: string;
  limit?: number;
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { repo_path, severity, module, status, scan_id, limit = 50 } = args;

  let targetScanId = scan_id;

  if (!targetScanId) {
    const existing = db
      .select()
      .from(repos)
      .where(eq(repos.path, repo_path))
      .get();

    if (!existing) {
      return {
        content: [
          {
            type: 'text',
            text: `No repo registered at ${repo_path}. Run vibecheck_scan first.`,
          },
        ],
      };
    }

    const scan = getLatestScan(existing.id);
    if (!scan) {
      return {
        content: [
          {
            type: 'text',
            text: `No completed scans found for ${existing.name}. Run vibecheck_scan first.`,
          },
        ],
      };
    }
    targetScanId = scan.id;
  }

  // Load all module results for this scan
  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, targetScanId))
    .all();

  // Optionally filter by module
  const filteredResults = module
    ? results.filter((r) => r.moduleId === module)
    : results;

  // Collect findings
  type FindingRow = {
    id: string;
    module: string;
    severity: string;
    file_path: string | null;
    line: number | null;
    message: string;
    category: string;
    status: string;
  };

  const allFindings: FindingRow[] = [];

  for (const result of filteredResults) {
    const rows = db
      .select()
      .from(findings)
      .where(eq(findings.moduleResultId, result.id))
      .all();

    for (const f of rows) {
      // Apply filters
      if (severity && f.severity !== severity) continue;
      if (status && f.status !== status) continue;

      allFindings.push({
        id: f.id,
        module: result.moduleId,
        severity: f.severity,
        file_path: f.filePath,
        line: f.line,
        message: f.message,
        category: f.category,
        status: f.status,
      });
    }
  }

  // Sort by severity priority then return limited results
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  allFindings.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
  );

  const limited = allFindings.slice(0, limit);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            scan_id: targetScanId,
            total: allFindings.length,
            returned: limited.length,
            findings: limited,
          },
          null,
          2
        ),
      },
    ],
  };
}
