import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubSearchResult {
  full_name: string;
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
}

// ---------------------------------------------------------------------------
// In-memory cache — 1-hour TTL per category
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: GitHubSearchResult[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Category → GitHub search query mapping
// ---------------------------------------------------------------------------

type Category = 'trending' | 'cli' | 'frameworks' | 'ai' | 'devtools';

const VALID_CATEGORIES = new Set<string>([
  'trending',
  'cli',
  'frameworks',
  'ai',
  'devtools',
]);

function buildQuery(category: Category): { q: string; sort: string; order: string } {
  switch (category) {
    case 'trending': {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      return {
        q: `created:>${thirtyDaysAgo} stars:>100`,
        sort: 'stars',
        order: 'desc',
      };
    }
    case 'cli':
      return { q: 'topic:cli stars:>500', sort: 'stars', order: 'desc' };
    case 'frameworks':
      return { q: 'topic:framework stars:>500', sort: 'stars', order: 'desc' };
    case 'ai':
      return {
        q: 'topic:machine-learning stars:>500',
        sort: 'stars',
        order: 'desc',
      };
    case 'devtools':
      return {
        q: 'topic:developer-tools stars:>500',
        sort: 'stars',
        order: 'desc',
      };
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const categoryParam = url.searchParams.get('category') || 'trending';

    if (!VALID_CATEGORIES.has(categoryParam)) {
      return NextResponse.json(
        {
          error: `Invalid category "${categoryParam}". Valid: ${[...VALID_CATEGORIES].join(', ')}`,
        },
        { status: 400 },
      );
    }

    const category = categoryParam as Category;

    // Check cache
    const cached = cache.get(category);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached.data);
    }

    // Build GitHub search API URL
    const { q, sort, order } = buildQuery(category);
    const encodedQuery = encodeURIComponent(q);
    const apiUrl = `search/repositories?q=${encodedQuery}&sort=${sort}&order=${order}&per_page=12`;

    let raw: string;
    try {
      raw = execSync(`gh api "${apiUrl}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('403') || message.includes('rate limit')) {
        return NextResponse.json(
          {
            error:
              'GitHub API rate limit exceeded. Authenticate with "gh auth login" or wait before retrying.',
          },
          { status: 429 },
        );
      }
      return NextResponse.json(
        { error: `GitHub search failed: ${message}` },
        { status: 502 },
      );
    }

    const data = JSON.parse(raw);
    const items: unknown[] = Array.isArray(data.items) ? data.items : [];

    const results: GitHubSearchResult[] = items.map((raw) => {
      const item = raw as Record<string, unknown>;
      const owner = item.owner as Record<string, unknown> | undefined;
      return {
        full_name: (item.full_name as string) ?? '',
        owner: (owner?.login as string) ?? '',
        repo: (item.name as string) ?? '',
        description: (item.description as string) ?? null,
        language: (item.language as string) ?? null,
        stargazers_count: (item.stargazers_count as number) ?? 0,
        forks_count: (item.forks_count as number) ?? 0,
        pushed_at: (item.pushed_at as string) ?? '',
      };
    });

    // Update cache
    cache.set(category, { data: results, timestamp: Date.now() });

    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
