"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreGauge } from "@/components/score-gauge";
import { ScanProgress } from "@/components/scan-progress";

interface Repo {
  id: string;
  name: string;
  path: string;
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
}

export function RepoHealthCard({ repo, onScanComplete }: RepoHealthCardProps) {
  const [scanning, setScanning] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="truncate font-bold">{repo.name}</span>
          <ScoreGauge score={repo.latestScan?.overallScore ?? null} size={56} />
        </CardTitle>
        <p className="text-xs text-muted-foreground truncate" title={repo.path}>
          {repo.path}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
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
            {scanning ? "Scanning..." : "Scan"}
          </Button>
          <Button variant="ghost" size="sm" render={<Link href={`/repo/${repo.id}`} />}>
            View
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
