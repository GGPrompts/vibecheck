import { NextResponse } from 'next/server';
import { generatePrompt } from '@/lib/prompt-generator/generator';

/**
 * GET /api/scans/[id]/prompt — Generate and return a Claude Code prompt
 * for a completed scan.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await generatePrompt(id);
    return NextResponse.json({
      prompt: result.prompt,
      estimated_tokens: result.estimated_tokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * POST /api/scans/[id]/prompt — Regenerate the prompt with custom options.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Options could include maxGroups, filterSeverity, etc. in the future
    const result = await generatePrompt(id);
    return NextResponse.json({
      prompt: result.prompt,
      estimated_tokens: result.estimated_tokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
