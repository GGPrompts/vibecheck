import type { GitHubMetadata } from './metadata';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CachedGitHubScan {
  scanId: string;
  repoId: string;
  metadata: GitHubMetadata;
  scannedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory cache keyed by "owner/repo@sha"
// ---------------------------------------------------------------------------

const globalForGhCache = globalThis as typeof globalThis & { __vcGhCache?: Map<string, CachedGitHubScan> };
const cache = globalForGhCache.__vcGhCache ??= new Map<string, CachedGitHubScan>();

function cacheKey(owner: string, repo: string, sha: string): string {
  return `${owner}/${repo}@${sha}`;
}

export function getCachedResult(
  owner: string,
  repo: string,
  sha: string,
): CachedGitHubScan | null {
  return cache.get(cacheKey(owner, repo, sha)) ?? null;
}

export function setCachedResult(
  owner: string,
  repo: string,
  sha: string,
  data: CachedGitHubScan,
): void {
  cache.set(cacheKey(owner, repo, sha), data);
}
