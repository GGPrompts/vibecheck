import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

/**
 * Minimal shape matching `ScanConfig` from the orchestrator.
 * Defined here to avoid a circular import (orchestrator -> vibecheckrc -> orchestrator).
 */
interface ScanConfig {
  enabledModules?: string[];
  weights?: Record<string, number>;
}

// ── Schema ──────────────────────────────────────────────────────────────

const vibecheckRcSchema = z.object({
  /** Enable/disable individual modules by id (true = enabled, false = disabled). */
  modules: z.record(z.string(), z.boolean()).optional(),

  /** Per-module score thresholds. If a module scores below its threshold it is flagged. */
  thresholds: z.record(z.string(), z.number().min(0).max(100)).optional(),

  /** Max AI token budget for a single scan (applies to AI-category modules). */
  aiTokenBudget: z.number().int().positive().optional(),

  /** Glob patterns for files/dirs the scan should ignore. */
  ignore: z.array(z.string()).optional(),
});

export type VibecheckRc = z.infer<typeof vibecheckRcSchema>;

// ── Reader ──────────────────────────────────────────────────────────────

const RC_FILENAMES = ['.vibecheckrc', '.vibecheckrc.json'] as const;

/**
 * Attempt to read and validate a `.vibecheckrc` (or `.vibecheckrc.json`) file
 * from the given directory.  Returns `null` when no rc file is found.
 *
 * Throws on validation errors so callers get a clear message about bad config.
 */
export function readVibecheckRc(repoRoot: string): VibecheckRc | null {
  for (const name of RC_FILENAMES) {
    const filePath = join(repoRoot, name);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, 'utf-8');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Failed to parse ${name}: invalid JSON`);
    }

    const result = vibecheckRcSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid ${name}:\n${issues}`);
    }

    return result.data;
  }

  return null;
}

// ── Merge ───────────────────────────────────────────────────────────────

/**
 * Merge a repo-level `.vibecheckrc` with the incoming `ScanConfig`.
 * Repo config wins when both specify the same key.
 *
 * The returned config is a plain `ScanConfig` so the rest of the
 * orchestrator pipeline needs zero changes.
 */
export function mergeWithRc(
  base: ScanConfig | undefined,
  rc: VibecheckRc
): ScanConfig {
  const merged: ScanConfig = { ...base };

  // ── modules → enabledModules ──
  if (rc.modules) {
    // Start from whatever the caller already had (or nothing)
    const enabled = new Set<string>(merged.enabledModules ?? []);
    for (const [id, on] of Object.entries(rc.modules)) {
      if (on) {
        enabled.add(id);
      } else {
        enabled.delete(id);
      }
    }
    merged.enabledModules = Array.from(enabled);
  }

  // ── thresholds / aiTokenBudget / ignore ──
  // Attach as extra fields on the config snapshot so they survive
  // serialisation to the DB and are available for downstream consumers.
  // We use a namespaced `rc` key to avoid collisions with core fields.
  (merged as ScanConfig & { rc?: Partial<VibecheckRc> }).rc = {
    ...(rc.thresholds ? { thresholds: rc.thresholds } : {}),
    ...(rc.aiTokenBudget != null ? { aiTokenBudget: rc.aiTokenBudget } : {}),
    ...(rc.ignore ? { ignore: rc.ignore } : {}),
  };

  return merged;
}
