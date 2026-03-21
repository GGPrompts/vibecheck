import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubMetadata {
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  license_spdx_id: string | null;
  topics: string[];
  created_at: string;
  pushed_at: string;
}

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
// Helpers
// ---------------------------------------------------------------------------

function assertGhInstalled(): void {
  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'GitHub CLI (gh) is not installed or not in PATH. Install it from https://cli.github.com/ and run "gh auth login".',
    );
  }
}

// ---------------------------------------------------------------------------
// fetchRepoMetadata
// ---------------------------------------------------------------------------

export async function fetchRepoMetadata(owner: string, repo: string): Promise<GitHubMetadata> {
  assertGhInstalled();

  let raw: string;
  try {
    raw = execSync(`gh api repos/${owner}/${repo}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15_000,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('404') || message.includes('Not Found')) {
      throw new Error(`Repository not found: ${owner}/${repo}`);
    }
    if (message.includes('403') || message.includes('rate limit')) {
      throw new Error(
        `GitHub API rate limit exceeded. Authenticate with "gh auth login" or wait before retrying.`,
      );
    }
    throw new Error(`Failed to fetch repo metadata for ${owner}/${repo}: ${message}`);
  }

  const data = JSON.parse(raw);

  return {
    owner,
    repo,
    description: data.description ?? null,
    language: data.language ?? null,
    stargazers_count: data.stargazers_count ?? 0,
    forks_count: data.forks_count ?? 0,
    open_issues_count: data.open_issues_count ?? 0,
    license_spdx_id: data.license?.spdx_id ?? null,
    topics: Array.isArray(data.topics) ? data.topics : [],
    created_at: data.created_at ?? '',
    pushed_at: data.pushed_at ?? '',
  };
}

// ---------------------------------------------------------------------------
// searchGitHubRepos
// ---------------------------------------------------------------------------

export async function searchGitHubRepos(
  query: string,
  limit: number = 10,
): Promise<GitHubSearchResult[]> {
  assertGhInstalled();

  if (!query.trim()) {
    return [];
  }

  const clampedLimit = Math.min(Math.max(1, limit), 100);

  let raw: string;
  try {
    const encodedQuery = encodeURIComponent(query);
    raw = execSync(
      `gh api "search/repositories?q=${encodedQuery}&per_page=${clampedLimit}"`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
      },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('403') || message.includes('rate limit')) {
      throw new Error(
        'GitHub API rate limit exceeded. Authenticate with "gh auth login" or wait before retrying.',
      );
    }
    throw new Error(`GitHub search failed for "${query}": ${message}`);
  }

  const data = JSON.parse(raw);
  const items: unknown[] = Array.isArray(data.items) ? data.items : [];

  return items.map((raw) => {
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
}
