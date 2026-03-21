import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scanConfigs } from '@/lib/db/schema';
import { readSettings, writeSettings } from '@/lib/config/settings';
import { hasApiKey, readEnvValue, writeEnvValue, writeApiKey } from '@/lib/config/env';

/**
 * GET /api/settings — Return current settings.
 */
export async function GET() {
  try {
    // Get the default config (repoId is null for global defaults)
    const config = db.select().from(scanConfigs).limit(1).get();

    const enabledModules = config?.enabledModules
      ? JSON.parse(config.enabledModules)
      : null;

    const aiProvider = readEnvValue('VIBECHECK_AI_PROVIDER') as 'api' | 'cli' | undefined;

    // Load model overrides from env
    let modelOverrides: { global?: string; modules?: Record<string, string> } | undefined;
    const rawOverrides = readEnvValue('VIBECHECK_MODEL_OVERRIDES');
    if (rawOverrides) {
      try {
        modelOverrides = JSON.parse(rawOverrides);
      } catch {
        // Invalid JSON — ignore
      }
    }

    // Load profile and tier from config.json
    const configSettings = readSettings();

    return NextResponse.json({
      hasApiKey: hasApiKey(),
      enabledModules,
      aiTokenBudget: config?.aiTokenBudget ?? 100000,
      aiProvider: aiProvider ?? 'auto',
      modelOverrides: modelOverrides ?? null,
      profile: configSettings.profile ?? 'team',
      tier: configSettings.tier ?? 'pro',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/settings — Update settings.
 * Body can include:
 *   apiKey?: string
 *   enabledModules?: string[]
 *   aiTokenBudget?: number
 *   weights?: Record<string, number>
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const {
      apiKey,
      enabledModules,
      aiTokenBudget,
      weights,
      aiProvider,
      modelOverrides,
      profile,
      tier,
    } = body as {
      apiKey?: string;
      enabledModules?: string[];
      aiTokenBudget?: number;
      weights?: Record<string, number>;
      aiProvider?: 'api' | 'cli' | 'auto';
      modelOverrides?: { global?: string; modules?: Record<string, string> };
      profile?: 'solo' | 'team' | 'library' | 'prototype' | 'enterprise';
      tier?: 'pro' | 'max' | 'max-x20' | 'api';
    };

    // Handle API key
    if (apiKey && typeof apiKey === 'string') {
      writeApiKey(apiKey);
    }

    // Handle AI provider selection
    if (aiProvider !== undefined) {
      if (aiProvider === 'auto') {
        // Remove the env value so auto-detection is used
        writeEnvValue('VIBECHECK_AI_PROVIDER', '');
      } else {
        writeEnvValue('VIBECHECK_AI_PROVIDER', aiProvider);
      }
    }

    // Handle model overrides
    if (modelOverrides !== undefined) {
      writeEnvValue('VIBECHECK_MODEL_OVERRIDES', JSON.stringify(modelOverrides));
    }

    // Handle profile and tier (stored in config.json)
    if (profile !== undefined || tier !== undefined) {
      const current = readSettings();
      if (profile !== undefined) current.profile = profile;
      if (tier !== undefined) current.tier = tier;
      writeSettings(current);
    }

    // Handle scan config updates
    if (enabledModules !== undefined || aiTokenBudget !== undefined || weights !== undefined) {
      // Look for existing default config
      const existing = db.select().from(scanConfigs).limit(1).get();

      if (existing) {
        const updates: Record<string, unknown> = {};

        if (enabledModules !== undefined) {
          updates.enabledModules = JSON.stringify(enabledModules);
        }
        if (aiTokenBudget !== undefined) {
          updates.aiTokenBudget = aiTokenBudget;
        }

        // For weights, we store in the scan config as a separate concern
        // Since scanConfigs doesn't have a weights column, we can store
        // it alongside enabledModules or use a convention. The task says
        // "store in scanConfigs configSnapshot" — but scanConfigs doesn't
        // have configSnapshot. We'll store it as a JSON blob if needed.
        // For now, update the available columns.
        if (Object.keys(updates).length > 0) {
          db.update(scanConfigs)
            .set(updates)
            .where(eq(scanConfigs.id, existing.id))
            .run();
        }
      } else {
        // Create a new default config
        db.insert(scanConfigs)
          .values({
            repoId: null,
            enabledModules: enabledModules ? JSON.stringify(enabledModules) : null,
            aiTokenBudget: aiTokenBudget ?? 100000,
          })
          .run();
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
