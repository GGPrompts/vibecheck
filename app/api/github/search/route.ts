import { NextResponse } from 'next/server';
import { searchGitHubRepos } from '@/lib/github/metadata';

/**
 * GET /api/github/search?q=<query>&limit=<number>
 *
 * Search GitHub repositories via the `gh` CLI.
 * Returns a JSON array of matching repos.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q');

    if (!q || !q.trim()) {
      return NextResponse.json(
        { error: 'q query parameter is required' },
        { status: 400 },
      );
    }

    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 10;

    if (isNaN(limit) || limit < 1) {
      return NextResponse.json(
        { error: 'limit must be a positive integer' },
        { status: 400 },
      );
    }

    const results = await searchGitHubRepos(q, limit);
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
