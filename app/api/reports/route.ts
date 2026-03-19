import { NextResponse } from 'next/server';
import { generateReport } from '@/lib/reporting/generator';

/**
 * POST /api/reports — Generate a compliance report.
 *
 * Body: { repoId: string, format: 'markdown' | 'html' }
 * Response: { report: string, format: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repoId, format } = body as { repoId?: string; format?: string };

    if (!repoId || typeof repoId !== 'string') {
      return NextResponse.json(
        { error: 'repoId is required and must be a string' },
        { status: 400 }
      );
    }

    if (format !== 'markdown' && format !== 'html') {
      return NextResponse.json(
        { error: 'format must be "markdown" or "html"' },
        { status: 400 }
      );
    }

    const report = await generateReport(repoId, format);

    return NextResponse.json({ report, format });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
