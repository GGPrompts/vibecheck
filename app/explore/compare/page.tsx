"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Plus, ArrowLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  ComparisonColumn,
  type GitHubMetadata,
  type ScanResult,
  type Finding,
} from "@/components/github/comparison-column";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoEntry {
  /** Unique key for React list rendering */
  key: string;
  owner: string;
  repo: string;
  metadata: GitHubMetadata | null;
  scanResult: ScanResult | null;
  loading: boolean;
  scanning: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOwnerRepo(input: string): { owner: string; repo: string } | null {
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

const MAX_REPOS = 3;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ComparePage() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyCounter = useRef(0);

  // ------ Add repo ------

  const addRepo = useCallback(
    (owner: string, repo: string) => {
      // Deduplicate
      const alreadyAdded = repos.some(
        (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase(),
      );
      if (alreadyAdded) {
        setInputError("This repo is already in the comparison.");
        return;
      }
      if (repos.length >= MAX_REPOS) {
        setInputError(`You can compare up to ${MAX_REPOS} repos at once.`);
        return;
      }

      const key = `repo-${++keyCounter.current}`;
      const entry: RepoEntry = {
        key,
        owner,
        repo,
        metadata: null,
        scanResult: null,
        loading: true,
        scanning: false,
        error: null,
      };

      setRepos((prev) => [...prev, entry]);
      setInputValue("");
      setInputError(null);

      // Fetch metadata + scan results
      fetchRepoData(key, owner, repo);
    },
    [repos],
  );

  const handleAdd = useCallback(() => {
    const parsed = parseOwnerRepo(inputValue);
    if (!parsed) {
      setInputError("Enter a valid GitHub URL or owner/repo (e.g. facebook/react)");
      return;
    }
    addRepo(parsed.owner, parsed.repo);
  }, [inputValue, addRepo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleAdd();
      }
    },
    [handleAdd],
  );

  // ------ Remove repo ------

  const removeRepo = useCallback((key: string) => {
    setRepos((prev) => prev.filter((r) => r.key !== key));
  }, []);

  // ------ Fetch metadata & scan results ------

  const fetchRepoData = useCallback(async (key: string, owner: string, repo: string) => {
    try {
      const res = await fetch(`/api/github/results/${owner}/${repo}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setRepos((prev) =>
          prev.map((r) =>
            r.key === key
              ? { ...r, loading: false, error: data?.error || "Failed to fetch repo data" }
              : r,
          ),
        );
        return;
      }

      const data = await res.json();

      let scanResult: ScanResult | null = null;
      if (data.scanned && data.scanId) {
        // Fetch detailed scan results including findings
        scanResult = await fetchScanDetails(data.scanId, data.overallScore, data.modules);
      }

      setRepos((prev) =>
        prev.map((r) =>
          r.key === key
            ? {
                ...r,
                loading: false,
                metadata: data.metadata ?? null,
                scanResult,
                scanning: data.scanning ?? false,
              }
            : r,
        ),
      );

      // If scan is in progress, poll for completion
      if (data.scanning && data.scanId) {
        pollForCompletion(key, owner, repo);
      }
    } catch {
      setRepos((prev) =>
        prev.map((r) =>
          r.key === key ? { ...r, loading: false, error: "Network error" } : r,
        ),
      );
    }
  }, []);

  // ------ Fetch detailed scan (with findings) ------

  async function fetchScanDetails(
    scanId: string,
    overallScore: number | null,
    moduleSummaries: Array<{ moduleId: string; score: number; confidence: number; summary: string | null }>,
  ): Promise<ScanResult> {
    try {
      const res = await fetch(`/api/scans/${scanId}`);
      if (res.ok) {
        const data = await res.json();
        const allFindings: Finding[] = [];
        const modules = (data.modules ?? []).map(
          (m: { moduleId: string; score: number; confidence: number; summary: string | null; findings?: Finding[] }) => {
            if (m.findings) {
              allFindings.push(...m.findings);
            }
            return {
              moduleId: m.moduleId,
              score: m.score,
              confidence: m.confidence,
              summary: m.summary,
            };
          },
        );

        return {
          scanId,
          overallScore: data.scan?.overallScore ?? overallScore,
          modules,
          findings: allFindings,
        };
      }
    } catch {
      // Fall through to basic result
    }

    // Fallback: return without findings
    return {
      scanId,
      overallScore,
      modules: moduleSummaries,
      findings: [],
    };
  }

  // ------ Poll for scan completion ------

  const pollForCompletion = useCallback(
    async (key: string, owner: string, repo: string) => {
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const res = await fetch(`/api/github/results/${owner}/${repo}`);
          if (!res.ok) continue;
          const data = await res.json();

          if (data.scanned && data.scanId) {
            const scanResult = await fetchScanDetails(data.scanId, data.overallScore, data.modules);
            setRepos((prev) =>
              prev.map((r) =>
                r.key === key
                  ? {
                      ...r,
                      scanning: false,
                      metadata: data.metadata ?? r.metadata,
                      scanResult,
                    }
                  : r,
              ),
            );
            return;
          }
          if (!data.scanning) {
            setRepos((prev) =>
              prev.map((r) =>
                r.key === key
                  ? { ...r, scanning: false, error: "Scan did not complete" }
                  : r,
              ),
            );
            return;
          }
        } catch {
          // Continue polling
        }
      }
      setRepos((prev) =>
        prev.map((r) =>
          r.key === key ? { ...r, scanning: false, error: "Scan timed out" } : r,
        ),
      );
    },
    [],
  );

  // ------ Trigger scan ------

  const triggerScan = useCallback(
    async (key: string, owner: string, repo: string) => {
      setRepos((prev) =>
        prev.map((r) => (r.key === key ? { ...r, scanning: true, error: null } : r)),
      );

      try {
        const repoUrl = `https://github.com/${owner}/${repo}`;
        const res = await fetch("/api/github/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl }),
        });
        const data = await res.json();

        if (!res.ok) {
          setRepos((prev) =>
            prev.map((r) =>
              r.key === key
                ? { ...r, scanning: false, error: data.error || "Scan failed" }
                : r,
            ),
          );
          return;
        }

        if (data.cached) {
          // Fetch results immediately for cached scan
          fetchRepoData(key, owner, repo);
        } else {
          pollForCompletion(key, owner, repo);
        }
      } catch {
        setRepos((prev) =>
          prev.map((r) =>
            r.key === key ? { ...r, scanning: false, error: "Network error" } : r,
          ),
        );
      }
    },
    [fetchRepoData, pollForCompletion],
  );

  // ------ Compute module highlights (best/worst per module row) ------

  const moduleHighlightsMap = computeModuleHighlights(repos);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/explore">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Explore
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Compare Repos</h1>
          <p className="text-muted-foreground text-sm">
            Side-by-side health comparison of up to {MAX_REPOS} repositories
          </p>
        </div>
      </div>

      {/* Add repo input */}
      <div className="flex items-start gap-2 max-w-lg">
        <div className="flex-1 space-y-1">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="owner/repo or GitHub URL..."
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setInputError(null);
              }}
              onKeyDown={handleKeyDown}
              className="h-9"
              disabled={repos.length >= MAX_REPOS}
            />
            <Button
              variant="outline"
              size="default"
              onClick={handleAdd}
              disabled={repos.length >= MAX_REPOS || !inputValue.trim()}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
          {inputError && (
            <p className="text-xs text-destructive">{inputError}</p>
          )}
        </div>
      </div>

      {/* Comparison columns */}
      {repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-16 text-center">
          <Plus className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            Add repos to compare
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
            Enter GitHub URLs or owner/repo shorthand above to start comparing
            code health side by side.
          </p>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${repos.length}, minmax(0, 1fr))`,
          }}
        >
          {repos.map((entry) => (
            <ComparisonColumn
              key={entry.key}
              owner={entry.owner}
              repo={entry.repo}
              metadata={entry.metadata}
              scanResult={entry.scanResult}
              loading={entry.loading}
              scanning={entry.scanning}
              onRemove={() => removeRepo(entry.key)}
              onScan={() => triggerScan(entry.key, entry.owner, entry.repo)}
              moduleHighlights={moduleHighlightsMap[entry.key] ?? {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight computation
// ---------------------------------------------------------------------------

/**
 * For each module that appears in at least 2 scanned repos, determine the
 * best (highest score) and worst (lowest score) column. Returns a map from
 * repo key -> { moduleId -> 'best' | 'worst' | null }.
 */
function computeModuleHighlights(
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
