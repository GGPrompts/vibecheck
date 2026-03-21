"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ExternalLink, ArrowRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/score-gauge";
import { GitHubStats } from "@/components/github/github-stats";

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

interface ScanState {
  status: "idle" | "scanning" | "done" | "error";
  scanId?: string;
  repoId?: string;
  score?: number | null;
  error?: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Rust: "#dea584",
  Go: "#00ADD8",
  Java: "#b07219",
  Ruby: "#701516",
  PHP: "#4F5D95",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  Lua: "#000080",
  Zig: "#ec915c",
  Elixir: "#6e4a7e",
  Haskell: "#5e5086",
  Scala: "#c22d40",
  Vue: "#41b883",
  Svelte: "#ff3e00",
};

function relativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  const diffYear = Math.floor(diffDay / 365);

  if (diffYear > 0) return `${diffYear} year${diffYear > 1 ? "s" : ""} ago`;
  if (diffMonth > 0) return `${diffMonth} month${diffMonth > 1 ? "s" : ""} ago`;
  if (diffWeek > 0) return `${diffWeek} week${diffWeek > 1 ? "s" : ""} ago`;
  if (diffDay > 0) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
  if (diffHr > 0) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  if (diffMin > 0) return `${diffMin} minute${diffMin > 1 ? "s" : ""} ago`;
  return "just now";
}

interface GitHubRepoCardProps {
  result: GitHubSearchResult;
}

export function GitHubRepoCard({ result }: GitHubRepoCardProps) {
  const router = useRouter();
  const [scan, setScan] = useState<ScanState>({ status: "idle" });

  const pollResults = useCallback(
    async (owner: string, repo: string) => {
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const res = await fetch(`/api/github/results/${owner}/${repo}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.scanned) {
            setScan((prev) => ({
              ...prev,
              status: "done",
              score: data.overallScore ?? null,
              repoId: prev.repoId,
            }));
            return;
          }
          if (!data.scanning) {
            // Not scanning and not scanned — scan may have failed
            setScan((prev) => ({
              ...prev,
              status: "error",
              error: "Scan did not complete",
            }));
            return;
          }
        } catch {
          // continue polling
        }
      }
      setScan((prev) => ({
        ...prev,
        status: "error",
        error: "Scan timed out",
      }));
    },
    [],
  );

  async function handleScan() {
    setScan({ status: "scanning" });
    try {
      const repoUrl = `https://github.com/${result.owner}/${result.repo}`;
      const res = await fetch("/api/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        setScan({ status: "error", error: data.error || "Scan failed" });
        return;
      }

      setScan({
        status: data.cached ? "done" : "scanning",
        scanId: data.scanId,
        repoId: data.repoId,
      });

      if (data.cached) {
        // Fetch score for cached result
        try {
          const resultRes = await fetch(
            `/api/github/results/${result.owner}/${result.repo}`,
          );
          if (resultRes.ok) {
            const resultData = await resultRes.json();
            if (resultData.scanned) {
              setScan({
                status: "done",
                scanId: data.scanId,
                repoId: data.repoId,
                score: resultData.overallScore ?? null,
              });
              return;
            }
          }
        } catch {
          // Fall through
        }
        setScan({
          status: "done",
          scanId: data.scanId,
          repoId: data.repoId,
          score: null,
        });
      } else {
        // Poll for completion
        pollResults(result.owner, result.repo);
      }
    } catch {
      setScan({ status: "error", error: "Network error" });
    }
  }

  function handleView() {
    if (scan.repoId) {
      router.push(`/repo/${scan.repoId}`);
    }
  }

  const langColor = result.language
    ? LANGUAGE_COLORS[result.language] || "#6b7280"
    : null;

  return (
    <Card className="flex flex-col h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">
              <a
                href={`https://github.com/${result.full_name}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline inline-flex items-center gap-1.5"
              >
                {result.full_name}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
              </a>
            </CardTitle>
          </div>
          {scan.status === "done" && scan.score != null && (
            <ScoreGauge score={scan.score} size={48} />
          )}
        </div>
        {result.description && (
          <CardDescription className="line-clamp-2">
            {result.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {result.language && (
            <Badge variant="secondary" className="gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: langColor ?? "#6b7280" }}
              />
              {result.language}
            </Badge>
          )}
          {result.pushed_at && (
            <span className="text-xs text-muted-foreground">
              Updated {relativeTime(result.pushed_at)}
            </span>
          )}
        </div>
        <GitHubStats
          stars={result.stargazers_count}
          forks={result.forks_count}
          openIssues={0}
        />
      </CardContent>
      <CardFooter>
        {scan.status === "idle" && (
          <Button variant="outline" size="sm" onClick={handleScan} className="w-full">
            Scan Health
          </Button>
        )}
        {scan.status === "scanning" && (
          <Button variant="outline" size="sm" disabled className="w-full">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Scanning...
          </Button>
        )}
        {scan.status === "done" && (
          <Button variant="outline" size="sm" onClick={handleView} className="w-full">
            <ArrowRight className="h-3.5 w-3.5" />
            View Results
          </Button>
        )}
        {scan.status === "error" && (
          <div className="flex items-center gap-2 w-full">
            <Button variant="outline" size="sm" onClick={handleScan} className="flex-1">
              Retry
            </Button>
            <span className="text-xs text-destructive truncate">
              {scan.error}
            </span>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
