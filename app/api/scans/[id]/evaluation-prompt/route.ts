import { NextResponse } from 'next/server';
import { generateEvaluationPrompt } from '@/lib/prompt-generator/evaluation-generator';

/**
 * GET /api/scans/[id]/evaluation-prompt — Generate and return an evaluation
 * report prompt for assessing a repo for adoption.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prompt = await generateEvaluationPrompt(id);
    return NextResponse.json({ prompt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
