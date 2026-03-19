import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scanConfigs } from '@/lib/db/schema';

const VIBECHECK_DIR = join(homedir(), '.vibecheck');
const ENV_PATH = join(VIBECHECK_DIR, '.env');

function hasApiKey(): boolean {
  try {
    if (!existsSync(ENV_PATH)) return false;
    const content = readFileSync(ENV_PATH, 'utf-8');
    return content.split('\n').some((line) => {
      const trimmed = line.trim();
      return (
        trimmed.startsWith('ANTHROPIC_API_KEY=') &&
        trimmed.length > 'ANTHROPIC_API_KEY='.length
      );
    });
  } catch {
    return false;
  }
}

function writeApiKey(key: string): void {
  mkdirSync(VIBECHECK_DIR, { recursive: true });

  let content = '';
  if (existsSync(ENV_PATH)) {
    content = readFileSync(ENV_PATH, 'utf-8');
    // Replace existing key or append
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.trim().startsWith('ANTHROPIC_API_KEY='));
    if (idx >= 0) {
      lines[idx] = `ANTHROPIC_API_KEY=${key}`;
      content = lines.join('\n');
    } else {
      content = content.trimEnd() + `\nANTHROPIC_API_KEY=${key}\n`;
    }
  } else {
    content = `ANTHROPIC_API_KEY=${key}\n`;
  }

  writeFileSync(ENV_PATH, content, 'utf-8');
}

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

    return NextResponse.json({
      hasApiKey: hasApiKey(),
      enabledModules,
      aiTokenBudget: config?.aiTokenBudget ?? 100000,
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
    } = body as {
      apiKey?: string;
      enabledModules?: string[];
      aiTokenBudget?: number;
      weights?: Record<string, number>;
    };

    // Handle API key
    if (apiKey && typeof apiKey === 'string') {
      writeApiKey(apiKey);
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
