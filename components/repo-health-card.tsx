"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/score-gauge";
import { ScanProgress } from "@/components/scan-progress";
import { Badge } from "@/components/ui/badge";

interface Repo {
  id: string;
  name: string;
  path: string;
  active?: boolean;
  mode?: "maintaining" | "evaluating";
  latestScan: {
    id: string;
    status: string;
    overallScore: number | null;
    createdAt: string;
  } | null;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

interface RepoHealthCardProps {
  repo: Repo;
  onScanComplete?: () => void;
  onActiveToggle?: (repoId: string, active: boolean) => void;
}

export function RepoHealthCard({ repo, onScanComplete, onActiveToggle }: RepoHealthCardProps) {
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const isEvaluation = repo.mode === "evaluating";
  const isActive = repo.active !== false;

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id }),
      });
      const data = await res.json();
      if (data.scanId) {
        setScanId(data.scanId);
      } else {
        setScanning(false);
      }
    } catch {
      setScanning(false);
    }
  }

  function handleScanComplete() {
    setScanning(false);
    setScanId(null);
    onScanComplete?.();
  }

  async function handleToggleActive() {
    setToggling(true);
    try {
      const res = await fetch("/api/repos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id, active: !isActive }),
      });
      if (res.ok) {
        onActiveToggle?.(repo.id, !isActive);
      }
    } catch {
      // Silently handle errors
    } finally {
      setToggling(false);
    }
  }

  // For evaluation repos, invert score display (high score = risky)
  const displayScore = isEvaluation && repo.latestScan?.overallScore != null
    ? 100 - repo.latestScan.overallScore
    : repo.latestScan?.overallScore ?? null;

  return (
    <Card
      className={[
        isEvaluation
          ? "border-dashed border-2 border-amber-500/40 bg-amber-50/5"
          : undefined,
        !isActive ? "opacity-50" : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="truncate font-bold">{repo.name}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleToggleActive}
              disabled={toggling}
              title={isActive ? "Deactivate repo" : "Activate repo"}
            >
              {isActive ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </Button>
            <ScoreGauge
              score={displayScore}
              size={56}
              invertColors={isEvaluation}
            />
          </div>
        </CardTitle>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground truncate flex-1" title={repo.path}>
            {repo.path}
          </p>
          {isEvaluation && (
            <Badge variant="outline" className="text-amber-600 border-amber-500/50 shrink-0">
              Evaluating
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isEvaluation && repo.latestScan?.overallScore != null && (
          <p className="text-xs font-medium text-amber-600">
            Adoption Risk: {displayScore}%
          </p>
        )}
        {scanning && scanId ? (
          <ScanProgress scanId={scanId} onComplete={handleScanComplete} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Last scanned: {formatRelativeTime(repo.latestScan?.createdAt ?? null)}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning
              ? isEvaluation ? "Evaluating..." : "Scanning..."
              : isEvaluation ? "Evaluate" : "Scan"}
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/repo/${repo.id}`} />}>
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
