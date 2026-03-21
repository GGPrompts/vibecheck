/**
 * vibecheck_settings — get or set vibecheck configuration.
 */
import { z } from 'zod';
import { eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scanConfigs } from '@/lib/db/schema';
import { readSettings, writeSettings } from '@/lib/config/settings';
import { readEnvValue, writeEnvValue } from '@/lib/config/env';
import { textResponse, jsonResponse } from './helpers.js';
import type { ToolResponse } from './helpers.js';

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
    .enum(['api', 'cli', 'auto', 'codex'])
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

type SettingsArgs = {
  action: 'get' | 'set';
  profile?: string;
  tier?: string;
  enabledModules?: string[];
  aiTokenBudget?: number;
  aiProvider?: string;
  modelOverrides?: { global?: string; modules?: Record<string, string | unknown> };
};

/** Read all current settings from their respective backends. */
function getSettings(): ToolResponse {
  const configSettings = readSettings();

  const config = db.select().from(scanConfigs).where(isNull(scanConfigs.repoId)).limit(1).get();
  const enabledModules = config?.enabledModules
    ? JSON.parse(config.enabledModules)
    : null;

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

  return jsonResponse({
    profile: configSettings.profile ?? 'team',
    tier: configSettings.tier ?? 'pro',
    enabledModules,
    aiTokenBudget: config?.aiTokenBudget ?? 100000,
    aiProvider,
    modelOverrides,
  });
}

/** Apply partial updates to the appropriate backends. */
function setSettings(args: SettingsArgs): ToolResponse {
  const { profile, tier, enabledModules, aiTokenBudget, aiProvider, modelOverrides } = args;

  // Profile/tier -> config.json
  if (profile !== undefined || tier !== undefined) {
    const current = readSettings();
    if (profile !== undefined) current.profile = profile as typeof current.profile;
    if (tier !== undefined) current.tier = tier as typeof current.tier;
    writeSettings(current);
  }

  // aiProvider -> .env
  if (aiProvider !== undefined) {
    writeEnvValue('VIBECHECK_AI_PROVIDER', aiProvider === 'auto' ? '' : aiProvider);
  }

  // modelOverrides -> .env
  if (modelOverrides !== undefined) {
    writeEnvValue('VIBECHECK_MODEL_OVERRIDES', JSON.stringify(modelOverrides));
  }

  // enabledModules/aiTokenBudget -> scanConfigs table
  if (enabledModules !== undefined || aiTokenBudget !== undefined) {
    updateScanConfigs(enabledModules, aiTokenBudget);
  }

  // Build a summary of what was changed
  const changed: string[] = [];
  if (profile !== undefined) changed.push(`profile=${profile}`);
  if (tier !== undefined) changed.push(`tier=${tier}`);
  if (enabledModules !== undefined) changed.push(`enabledModules=[${enabledModules.length} modules]`);
  if (aiTokenBudget !== undefined) changed.push(`aiTokenBudget=${aiTokenBudget}`);
  if (aiProvider !== undefined) changed.push(`aiProvider=${aiProvider}`);
  if (modelOverrides !== undefined) changed.push('modelOverrides=updated');

  return jsonResponse({ success: true, updated: changed });
}

/** Upsert enabledModules and aiTokenBudget into the scanConfigs table. */
function updateScanConfigs(enabledModules?: string[], aiTokenBudget?: number): void {
  const existing = db.select().from(scanConfigs).where(isNull(scanConfigs.repoId)).limit(1).get();

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

export async function handleVibecheckSettings(args: SettingsArgs): Promise<ToolResponse> {
  try {
    if (args.action === 'get') {
      return getSettings();
    }
    return setSettings(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResponse(`Settings operation failed: ${message}`);
  }
}
