import type { ScanResult } from "@/components/github/comparison-column";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoEntry {
  /** Unique key for React list rendering */
  key: string;
  owner: string;
  repo: string;
  metadata: import("@/components/github/comparison-column").GitHubMetadata | null;
  scanResult: ScanResult | null;
  loading: boolean;
  scanning: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseOwnerRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\/+$/, "");

  // Full GitHub URL
  const urlMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/,
  );
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2] };
  }

  // owner/repo shorthand
  const shortMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  return null;
}

export const MAX_REPOS = 3;

/**
 * For each module that appears in at least 2 scanned repos, determine the
 * best (highest score) and worst (lowest score) column. Returns a map from
 * repo key -> { moduleId -> 'best' | 'worst' | null }.
 */
export function computeModuleHighlights(
  repos: RepoEntry[],
): Record<string, Record<string, "best" | "worst" | null>> {
  const result: Record<string, Record<string, "best" | "worst" | null>> = {};
  for (const r of repos) {
    result[r.key] = {};
  }

  // Collect all module IDs across scanned repos
  const scannedRepos = repos.filter((r) => r.scanResult);
  if (scannedRepos.length < 2) return result;

  const allModuleIds = new Set<string>();
  for (const r of scannedRepos) {
    for (const m of r.scanResult!.modules) {
      allModuleIds.add(m.moduleId);
    }
  }

  for (const moduleId of allModuleIds) {
    // Gather scores for this module across repos
    const entries: { key: string; score: number }[] = [];
    for (const r of scannedRepos) {
      const mod = r.scanResult!.modules.find((m) => m.moduleId === moduleId);
      if (mod) {
        entries.push({ key: r.key, score: mod.score });
      }
    }

    if (entries.length < 2) continue;

    const maxScore = Math.max(...entries.map((e) => e.score));
    const minScore = Math.min(...entries.map((e) => e.score));

    // Only highlight if there's actually a difference
    if (maxScore === minScore) continue;

    for (const e of entries) {
      if (e.score === maxScore) {
        result[e.key][moduleId] = "best";
      } else if (e.score === minScore) {
        result[e.key][moduleId] = "worst";
      }
    }
  }

  return result;
}
