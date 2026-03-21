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
import { readSettings, writeSettings } from '@/lib/config/settings';
import { readEnvValue, writeEnvValue } from '@/lib/config/env';

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

export const vibecheckSettingsInput = {
  action: z.enum(['get', 'set']).describe('Whether to read or write settings'),
  profile: z
    .enum(['solo', 'team', 'library', 'prototype', 'enterprise'])
    .optional()
    .describe('Project profile preset (set only)'),
  tier: z
    .enum(['pro', 'max', 'max-x20', 'api'])
    .optional()
    .describe('Scan depth tier (set only)'),
  enabledModules: z
    .array(z.string())
    .optional()
    .describe('List of module IDs to enable (set only)'),
  aiTokenBudget: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('AI token budget per scan (set only)'),
  aiProvider: z
    .enum(['api', 'cli', 'auto'])
    .optional()
    .describe('AI provider selection (set only)'),
  modelOverrides: z
    .object({
      global: z.string().optional(),
      modules: z.record(z.string(), z.string()).optional(),
    })
    .optional()
    .describe('Model override configuration (set only)'),
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

/**
 * vibecheck_settings — get or set vibecheck configuration.
 */
export async function handleVibecheckSettings(args: {
  action: 'get' | 'set';
  profile?: string;
  tier?: string;
  enabledModules?: string[];
  aiTokenBudget?: number;
  aiProvider?: string;
  modelOverrides?: { global?: string; modules?: Record<string, string | unknown> };
}): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (args.action === 'get') {
      // Profile + tier from config.json
      const configSettings = readSettings();

      // enabledModules + aiTokenBudget from scanConfigs table
      const config = db.select().from(scanConfigs).limit(1).get();
      const enabledModules = config?.enabledModules
        ? JSON.parse(config.enabledModules)
        : null;

      // aiProvider + modelOverrides from .env
      const aiProvider = readEnvValue('VIBECHECK_AI_PROVIDER') || 'auto';

      let modelOverrides: { global?: string; modules?: Record<string, string> } | null = null;
      const rawOverrides = readEnvValue('VIBECHECK_MODEL_OVERRIDES');
      if (rawOverrides) {
        try {
          modelOverrides = JSON.parse(rawOverrides);
        } catch {
          // Invalid JSON — ignore
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                profile: configSettings.profile ?? 'team',
                tier: configSettings.tier ?? 'pro',
                enabledModules,
                aiTokenBudget: config?.aiTokenBudget ?? 100000,
                aiProvider,
                modelOverrides,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // SET action — write partial updates to appropriate backends
    const { profile, tier, enabledModules, aiTokenBudget, aiProvider, modelOverrides } = args;

    // Profile/tier → config.json
    if (profile !== undefined || tier !== undefined) {
      const current = readSettings();
      if (profile !== undefined) current.profile = profile as typeof current.profile;
      if (tier !== undefined) current.tier = tier as typeof current.tier;
      writeSettings(current);
    }

    // aiProvider → .env
    if (aiProvider !== undefined) {
      if (aiProvider === 'auto') {
        writeEnvValue('VIBECHECK_AI_PROVIDER', '');
      } else {
        writeEnvValue('VIBECHECK_AI_PROVIDER', aiProvider);
      }
    }

    // modelOverrides → .env
    if (modelOverrides !== undefined) {
      writeEnvValue('VIBECHECK_MODEL_OVERRIDES', JSON.stringify(modelOverrides));
    }

    // enabledModules/aiTokenBudget → scanConfigs table
    if (enabledModules !== undefined || aiTokenBudget !== undefined) {
      const existing = db.select().from(scanConfigs).limit(1).get();

      if (existing) {
        const updates: Record<string, unknown> = {};
        if (enabledModules !== undefined) {
          updates.enabledModules = JSON.stringify(enabledModules);
        }
        if (aiTokenBudget !== undefined) {
          updates.aiTokenBudget = aiTokenBudget;
        }
        if (Object.keys(updates).length > 0) {
          db.update(scanConfigs)
            .set(updates)
            .where(eq(scanConfigs.id, existing.id))
            .run();
        }
      } else {
        db.insert(scanConfigs)
          .values({
            repoId: null,
            enabledModules: enabledModules ? JSON.stringify(enabledModules) : null,
            aiTokenBudget: aiTokenBudget ?? 100000,
          })
          .run();
      }
    }

    // Build a summary of what was changed
    const changed: string[] = [];
    if (profile !== undefined) changed.push(`profile=${profile}`);
    if (tier !== undefined) changed.push(`tier=${tier}`);
    if (enabledModules !== undefined) changed.push(`enabledModules=[${enabledModules.length} modules]`);
    if (aiTokenBudget !== undefined) changed.push(`aiTokenBudget=${aiTokenBudget}`);
    if (aiProvider !== undefined) changed.push(`aiProvider=${aiProvider}`);
    if (modelOverrides !== undefined) changed.push('modelOverrides=updated');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              updated: changed,
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
      content: [{ type: 'text', text: `Settings operation failed: ${message}` }],
    };
  }
}
