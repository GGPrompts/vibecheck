import { NextResponse } from 'next/server';
import { readSettings, writeSettings } from '@/lib/config/settings';
import { getAllAuditPrompts } from '@/lib/audit/prompts';

/**
 * GET /api/settings/audit-prompts — Return current prompts per module.
 *
 * For each available audit module, returns the custom prompt if one has been
 * set, otherwise the default system prompt from prompts.ts.
 *
 * Response: { prompts: Record<string, { moduleId: string; name: string; prompt: string; isCustom: boolean }> }
 */
export async function GET() {
  try {
    const settings = readSettings();
    const customPrompts = settings.auditPrompts ?? {};
    const allTemplates = getAllAuditPrompts();

    const prompts: Record<
      string,
      { moduleId: string; name: string; prompt: string; isCustom: boolean }
    > = {};

    for (const template of allTemplates) {
      const hasCustom = template.moduleId in customPrompts;
      prompts[template.moduleId] = {
        moduleId: template.moduleId,
        name: template.name,
        prompt: hasCustom
          ? customPrompts[template.moduleId]
          : template.systemPrompt,
        isCustom: hasCustom,
      };
    }

    return NextResponse.json({ prompts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/settings/audit-prompts — Save custom audit prompts.
 *
 * Body: { prompts: Record<string, string> }
 *
 * Only non-empty strings that differ from the default are persisted.
 * Passing an empty string (or omitting a module) clears the custom prompt
 * for that module.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { prompts } = body as { prompts?: Record<string, string> };

    if (typeof prompts !== 'object' || prompts === null || Array.isArray(prompts)) {
      return NextResponse.json(
        { error: 'prompts must be a Record<string, string>' },
        { status: 400 },
      );
    }

    // Build a clean map: only keep non-empty custom prompts
    const allTemplates = getAllAuditPrompts();
    const defaultPromptMap = new Map(
      allTemplates.map((t) => [t.moduleId, t.systemPrompt]),
    );

    const cleaned: Record<string, string> = {};
    for (const [moduleId, prompt] of Object.entries(prompts)) {
      if (typeof prompt !== 'string') continue;
      const trimmed = prompt.trim();
      // Only persist if non-empty and different from the default
      if (trimmed.length > 0 && trimmed !== defaultPromptMap.get(moduleId)) {
        cleaned[moduleId] = trimmed;
      }
    }

    const settings = readSettings();
    if (Object.keys(cleaned).length > 0) {
      settings.auditPrompts = cleaned;
    } else {
      delete settings.auditPrompts;
    }
    writeSettings(settings);

    return NextResponse.json({ success: true, auditPrompts: cleaned });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
