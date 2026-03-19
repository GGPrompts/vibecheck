import { NextResponse } from 'next/server';
import { readSettings, writeSettings } from '@/lib/config/settings';
import { getDefaultScanDirs } from '@/lib/discovery/scanner';

/**
 * GET /api/settings/scan-dirs — Return the current scan directories.
 *
 * Response: { scanDirs: string[], isDefault: boolean }
 */
export async function GET() {
  try {
    const settings = readSettings();
    const hasCustom = Array.isArray(settings.scanDirs) && settings.scanDirs.length > 0;

    return NextResponse.json({
      scanDirs: hasCustom ? settings.scanDirs : getDefaultScanDirs(),
      isDefault: !hasCustom,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PUT /api/settings/scan-dirs — Update the scan directories.
 *
 * Body: { scanDirs: string[] }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { scanDirs } = body as { scanDirs?: string[] };

    if (!Array.isArray(scanDirs)) {
      return NextResponse.json(
        { error: 'scanDirs must be an array of strings' },
        { status: 400 },
      );
    }

    const filtered = scanDirs.filter(
      (d) => typeof d === 'string' && d.trim().length > 0,
    );

    const settings = readSettings();
    settings.scanDirs = filtered;
    writeSettings(settings);

    return NextResponse.json({ success: true, scanDirs: filtered });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
