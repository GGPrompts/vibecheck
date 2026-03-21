"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ComparisonColumn,
  type Finding,
  type ScanResult,
} from "@/components/github/comparison-column";
import { CompareInput } from "@/components/explore/compare-input";
import { CompareEmptyState } from "@/components/explore/compare-empty-state";
import {
  type RepoEntry,
  parseOwnerRepo,
  MAX_REPOS,
  computeModuleHighlights,
} from "@/components/explore/compare-helpers";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ComparePage() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const keyCounter = useRef(0);

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
  }, [pollForCompletion]);

  // ------ Remove repo ------

  const removeRepo = useCallback((key: string) => {
    setRepos((prev) => prev.filter((r) => r.key !== key));
  }, []);

  // ------ Add repo ------

  const addRepo = useCallback(
    (owner: string, repo: string) => {
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

      fetchRepoData(key, owner, repo);
    },
    [repos, fetchRepoData],
  );

  const handleAdd = useCallback(() => {
    const parsed = parseOwnerRepo(inputValue);
    if (!parsed) {
      setInputError("Enter a valid GitHub URL or owner/repo (e.g. facebook/react)");
      return;
    }
    addRepo(parsed.owner, parsed.repo);
  }, [inputValue, addRepo]);

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

      <CompareInput
        inputValue={inputValue}
        inputError={inputError}
        disabled={repos.length >= MAX_REPOS}
        onInputChange={(value) => {
          setInputValue(value);
          setInputError(null);
        }}
        onAdd={handleAdd}
      />

      {/* Comparison columns */}
      {repos.length === 0 ? (
        <CompareEmptyState />
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
