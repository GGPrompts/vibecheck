import { NextResponse } from 'next/server';
import { installHook, uninstallHook, isHookInstalled } from '@/lib/hooks/install';
import { getHealthTrend } from '@/lib/hooks/query';

/**
 * POST /api/hooks — Install or uninstall the vibecheck post-commit hook.
 * Body: { repoPath: string, action: 'install' | 'uninstall' }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repoPath, action } = body as { repoPath: string; action: string };

    if (!repoPath || typeof repoPath !== 'string') {
      return NextResponse.json(
        { error: 'repoPath is required and must be a string' },
        { status: 400 }
      );
    }

    if (action !== 'install' && action !== 'uninstall') {
      return NextResponse.json(
        { error: "action must be 'install' or 'uninstall'" },
        { status: 400 }
      );
    }

    const result =
      action === 'install' ? installHook(repoPath) : uninstallHook(repoPath);

    return NextResponse.json(result, { status: result.success ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/hooks?repoPath=<path> — Check hook status and get snapshots.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const repoPath = searchParams.get('repoPath');

    if (!repoPath) {
      return NextResponse.json(
        { error: 'repoPath query parameter is required' },
        { status: 400 }
      );
    }

    const installed = isHookInstalled(repoPath);
    const snapshots = getHealthTrend(repoPath);

    return NextResponse.json({ installed, snapshots });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
