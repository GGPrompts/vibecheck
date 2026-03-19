import { NextResponse } from 'next/server';
import { generateScanReport } from '@/lib/reporting/generator';
import type { ScanReportFormat } from '@/lib/reporting/generator';

/**
 * GET /api/reports/[scanId]?format=md|html|html-standalone
 *
 * Generate a full scan report for the given scan ID.
 * Defaults to Markdown if no format is specified.
 *
 * - `md`              — Markdown report
 * - `html`            — HTML report (assumes server context for assets)
 * - `html-standalone` — Self-contained HTML with embedded SVG charts;
 *                        opens in any browser without a server
 *
 * Returns the report as a downloadable file with appropriate content type
 * when `download=true` is set, otherwise returns JSON.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  try {
    const { scanId } = await params;
    const url = new URL(request.url);
    const formatParam = url.searchParams.get('format') || 'md';
    const download = url.searchParams.get('download') === 'true';

    const validFormats: ScanReportFormat[] = ['md', 'html', 'html-standalone'];
    if (!validFormats.includes(formatParam as ScanReportFormat)) {
      return NextResponse.json(
        { error: 'format must be "md", "html", or "html-standalone"' },
        { status: 400 }
      );
    }

    const format = formatParam as ScanReportFormat;
    const report = await generateScanReport(scanId, format);

    if (download) {
      const ext = format === 'md' ? 'md' : 'html';
      const contentType = format === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
      return new Response(report, {
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="vibecheck-report-${scanId}.${ext}"`,
        },
      });
    }

    return NextResponse.json({ report, format, scanId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
