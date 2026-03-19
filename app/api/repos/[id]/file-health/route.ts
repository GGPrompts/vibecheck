import { NextResponse } from 'next/server';
import { aggregateFileHealth } from '@/lib/visualizer/file-health';

/**
 * GET /api/repos/[id]/file-health?scanId=...
 *
 * Returns a per-file health map aggregated from scan findings.
 * If no scanId is provided, uses the latest completed scan.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: repoId } = await params;
    const url = new URL(request.url);
    const scanId = url.searchParams.get('scanId') ?? undefined;

    const healthMap = aggregateFileHealth(repoId, scanId);

    return NextResponse.json(healthMap);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
