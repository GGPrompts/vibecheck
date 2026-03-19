"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Eye, EyeOff, ExternalLink, X, Copy, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/score-gauge";
import { ScanProgress } from "@/components/scan-progress";
import { Badge } from "@/components/ui/badge";

const PROFILE_COLORS: Record<string, string> = {
  solo: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  team: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  library: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  prototype: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  enterprise: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

// Module-level cache so all cards share one fetch
let _profileCache: string | null = null;
let _profilePromise: Promise<string> | null = null;

function fetchGlobalProfile(): Promise<string> {
  if (_profilePromise) return _profilePromise;
  _profilePromise = fetch("/api/settings")
    .then((res) => res.json())
    .then((data): string => {
      const p: string = data.profile ?? "team";
      _profileCache = p;
      return p;
    })
    .catch((): string => {
      _profileCache = "team";
      return "team";
    });
  return _profilePromise;
}

interface Repo {
  id: string;
  name: string;
  path: string;
  active?: boolean;
  mode?: "maintaining" | "evaluating";
  metadata?: string | null;
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
  onRemove?: (repoId: string) => void;
}

export function RepoHealthCard({ repo, onScanComplete, onActiveToggle, onRemove }: RepoHealthCardProps) {
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<string | null>(_profileCache);

  useEffect(() => {
    if (_profileCache) {
      setProfile(_profileCache);
      return;
    }
    fetchGlobalProfile().then(setProfile);
  }, []);

  const isEvaluation = repo.mode === "evaluating";
  const isActive = repo.active !== false;

  // Parse GitHub URL from metadata if present
  let githubUrl: string | null = null;
  if (repo.metadata) {
    try {
      const meta = JSON.parse(repo.metadata);
      if (meta.github) githubUrl = meta.github;
    } catch { /* ignore */ }
  }

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

  async function handleRemove() {
    try {
      await fetch("/api/repos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: repo.id }),
      });
      onRemove?.(repo.id);
    } catch { /* ignore */ }
  }

  function handleCopyClone() {
    if (!githubUrl) return;
    navigator.clipboard.writeText(`git clone ${githubUrl}.git`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
            {githubUrl && onRemove && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleRemove}
                title="Remove repo"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
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
          {githubUrl ? (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground truncate flex-1 flex items-center gap-1"
              title={githubUrl}
            >
              {githubUrl.replace("https://github.com/", "")}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          ) : (
            <p className="text-xs text-muted-foreground truncate flex-1" title={repo.path}>
              {repo.path}
            </p>
          )}
          {profile && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 ${
                PROFILE_COLORS[profile] ?? PROFILE_COLORS.team
              }`}
            >
              {profile}
            </span>
          )}
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
          {githubUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyClone}
              title="Copy git clone command"
            >
              {copied ? (
                <><Check className="h-3.5 w-3.5 mr-1" />Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5 mr-1" />Clone</>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
