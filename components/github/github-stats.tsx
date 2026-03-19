"use client";

import { Star, GitFork, CircleDot } from "lucide-react";

interface GitHubStatsProps {
  stars: number;
  forks: number;
  openIssues: number;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

export function GitHubStats({ stars, forks, openIssues }: GitHubStatsProps) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Star className="h-3.5 w-3.5" />
        {formatCount(stars)}
      </span>
      <span className="flex items-center gap-1">
        <GitFork className="h-3.5 w-3.5" />
        {formatCount(forks)}
      </span>
      <span className="flex items-center gap-1">
        <CircleDot className="h-3.5 w-3.5" />
        {formatCount(openIssues)}
      </span>
    </div>
  );
}
