"use client";

import { Loader2, X, ExternalLink, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreGauge } from "@/components/score-gauge";
import { GitHubStats } from "@/components/github/github-stats";

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

export interface ModuleScore {
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
}

export interface Finding {
  id: string;
  severity: string;
  message: string;
  filePath: string | null;
  category: string;
}

export interface ScanResult {
  scanId: string;
  overallScore: number | null;
  modules: ModuleScore[];
  findings: Finding[];
}

interface ComparisonColumnProps {
  owner: string;
  repo: string;
  metadata: GitHubMetadata | null;
  scanResult: ScanResult | null;
  loading: boolean;
  scanning: boolean;
  onRemove: () => void;
  onScan: () => void;
  /** Map of moduleId -> 'best' | 'worst' | null for highlighting */
  moduleHighlights?: Record<string, "best" | "worst" | null>;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_ICON: Record<string, typeof AlertTriangle> = {
  critical: AlertCircle,
  high: AlertTriangle,
  medium: AlertTriangle,
  low: Info,
  info: Info,
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-500",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-blue-400",
  info: "text-muted-foreground",
};

function formatModuleName(moduleId: string): string {
  return moduleId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function ComparisonColumn({
  owner,
  repo,
  metadata,
  scanResult,
  loading,
  scanning,
  onRemove,
  onScan,
  moduleHighlights = {},
}: ComparisonColumnProps) {
  if (loading) {
    return (
      <Card className="flex flex-col h-full min-w-0">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-5 w-3/4" />
            <Button variant="ghost" size="xs" onClick={onRemove}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Skeleton className="h-4 w-full mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-20 rounded-full mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  const topFindings = scanResult
    ? [...scanResult.findings]
        .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5))
        .slice(0, 5)
    : [];

  return (
    <Card className="flex flex-col h-full min-w-0">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="truncate text-sm">
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline inline-flex items-center gap-1.5"
            >
              {owner}/{repo}
              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
            </a>
          </CardTitle>
          <Button variant="ghost" size="xs" onClick={onRemove} className="shrink-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        {metadata?.description && (
          <CardDescription className="line-clamp-2 text-xs">
            {metadata.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex-1 space-y-5">
        {/* GitHub stats */}
        {metadata && (
          <div className="space-y-2">
            <GitHubStats
              stars={metadata.stargazers_count}
              forks={metadata.forks_count}
              openIssues={metadata.open_issues_count}
            />
            {metadata.pushed_at && (
              <p className="text-xs text-muted-foreground">
                Last push: {new Date(metadata.pushed_at).toLocaleDateString()}
              </p>
            )}
          </div>
        )}

        {/* Scan button or results */}
        {!scanResult && !scanning && (
          <Button variant="outline" size="sm" onClick={onScan} className="w-full">
            Scan Health
          </Button>
        )}

        {scanning && (
          <Button variant="outline" size="sm" disabled className="w-full">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Scanning...
          </Button>
        )}

        {scanResult && (
          <>
            {/* Overall score gauge */}
            <div className="flex flex-col items-center gap-1">
              <ScoreGauge score={scanResult.overallScore} size={72} />
              <span className="text-xs text-muted-foreground font-medium">Overall Score</span>
            </div>

            {/* Per-module scores */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Modules
              </h4>
              {scanResult.modules
                .slice()
                .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
                .map((mod) => {
                  const highlight = moduleHighlights[mod.moduleId];
                  const highlightClass =
                    highlight === "best"
                      ? "bg-green-500/10 text-green-400"
                      : highlight === "worst"
                        ? "bg-red-500/10 text-red-400"
                        : "";

                  return (
                    <div
                      key={mod.moduleId}
                      className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs ${highlightClass}`}
                    >
                      <span className="truncate">{formatModuleName(mod.moduleId)}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${mod.score}%`,
                              backgroundColor:
                                mod.score > 70
                                  ? "#22c55e"
                                  : mod.score >= 40
                                    ? "#eab308"
                                    : "#ef4444",
                            }}
                          />
                        </div>
                        <span className="w-7 text-right font-mono">{mod.score}</span>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Top findings */}
            {topFindings.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Top Findings
                </h4>
                {topFindings.map((finding) => {
                  const Icon = SEVERITY_ICON[finding.severity] ?? Info;
                  const color = SEVERITY_COLOR[finding.severity] ?? "text-muted-foreground";
                  return (
                    <div key={finding.id} className="flex items-start gap-1.5 text-xs">
                      <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${color}`} />
                      <div className="min-w-0">
                        <span className="line-clamp-2">{finding.message}</span>
                        {finding.filePath && (
                          <span className="text-muted-foreground/60 block truncate text-[10px]">
                            {finding.filePath}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
