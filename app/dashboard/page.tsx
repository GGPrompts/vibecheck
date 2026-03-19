"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, Play, X, AlertTriangle, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RepoHealthCard } from "@/components/repo-health-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreGauge } from "@/components/score-gauge";

interface Repo {
  id: string;
  name: string;
  path: string;
  mode: "maintaining" | "evaluating";
  parentRepoId: string | null;
  latestScan: {
    id: string;
    status: string;
    overallScore: number | null;
    createdAt: string;
  } | null;
}

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  results: Array<{ repoId: string; repoName: string; scanId?: string; error?: string }>;
}

export default function DashboardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState("");
  const [isEvaluation, setIsEvaluation] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Batch scan state
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [batchStarting, setBatchStarting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastCompletedRef = useRef(0);

  const fetchRepos = useCallback(async () => {
    try {
      const res = await fetch("/api/repos");
      const data = await res.json();
      if (Array.isArray(data)) {
        setRepos(data);
      }
    } catch {
      // Silently handle fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  // SSE listener for batch progress
  useEffect(() => {
    if (!batchId) return;

    const es = new EventSource(`/api/scans/batch?batchId=${batchId}`);
    eventSourceRef.current = es;
    lastCompletedRef.current = 0;

    es.onmessage = (event) => {
      try {
        const progress: BatchProgress = JSON.parse(event.data);
        setBatchProgress(progress);

        // Refresh repos when a new repo scan completes
        if (progress.completed > lastCompletedRef.current) {
          lastCompletedRef.current = progress.completed;
          fetchRepos();
        }
      } catch {
        // Ignore parse errors (e.g., keepalive comments)
      }
    };

    es.addEventListener("done", () => {
      es.close();
      eventSourceRef.current = null;
      // Final refresh after batch completes
      fetchRepos();
      // Keep the banner visible briefly so user can see final status
      setTimeout(() => {
        setBatchId(null);
        setBatchProgress(null);
      }, 3000);
    });

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [batchId, fetchRepos]);

  async function handleAddRepo() {
    if (!newRepoPath.trim()) return;
    setAdding(true);
    setAddError(null);

    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: newRepoPath.trim(),
          mode: isEvaluation ? "evaluating" : "maintaining",
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || "Failed to add repository");
        setAdding(false);
        return;
      }

      setNewRepoPath("");
      setIsEvaluation(false);
      setDialogOpen(false);
      fetchRepos();
    } catch {
      setAddError("Failed to add repository");
    } finally {
      setAdding(false);
    }
  }

  async function handleBatchScan() {
    setBatchStarting(true);
    try {
      const res = await fetch("/api/scans/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoIds: "all" }),
      });
      const data = await res.json();
      if (data.batchId) {
        setBatchId(data.batchId);
        setBatchProgress({
          total: repos.length,
          completed: 0,
          failed: 0,
          current: null,
          results: [],
        });
      }
    } catch {
      // Silently handle errors
    } finally {
      setBatchStarting(false);
    }
  }

  async function handleCancelBatch() {
    if (!batchId) return;
    try {
      await fetch("/api/scans/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
    } catch {
      // Best-effort cancel
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setBatchId(null);
    setBatchProgress(null);
    fetchRepos();
  }

  const isBatchRunning = batchId !== null;
  const batchDone = batchProgress !== null && batchProgress.current === null && batchProgress.completed === batchProgress.total;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of all registered repositories
          </p>
        </div>
        <div className="flex items-center gap-2">
          {repos.length > 0 && (
            <Button
              variant="outline"
              onClick={handleBatchScan}
              disabled={isBatchRunning || batchStarting}
            >
              <Play className="h-4 w-4" />
              {batchStarting ? "Starting..." : "Scan All"}
            </Button>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button>
                  <Plus className="h-4 w-4" />
                  Add Repo
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Repository</DialogTitle>
                <DialogDescription>
                  Enter the absolute path to a local repository.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="repo-path">Repository Path</Label>
                  <Input
                    id="repo-path"
                    placeholder="/home/user/projects/my-repo"
                    value={newRepoPath}
                    onChange={(e) => setNewRepoPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddRepo();
                    }}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="eval-mode"
                    checked={isEvaluation}
                    onCheckedChange={setIsEvaluation}
                  />
                  <Label htmlFor="eval-mode" className="cursor-pointer">
                    {isEvaluation ? "Evaluating (external repo)" : "Maintaining (your repo)"}
                  </Label>
                </div>
                {isEvaluation && (
                  <p className="text-xs text-muted-foreground">
                    Evaluation mode assesses this repo for adoption risk instead of maintenance health.
                  </p>
                )}
                {addError && (
                  <p className="text-xs text-destructive">{addError}</p>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleAddRepo} disabled={adding || !newRepoPath.trim()}>
                  {adding ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Batch progress banner */}
      {batchProgress && (
        <BatchProgressBanner
          progress={batchProgress}
          done={batchDone}
          onCancel={handleCancelBatch}
        />
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 rounded-xl bg-muted/50 animate-pulse"
            />
          ))}
        </div>
      ) : repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            No repositories yet. Add one to get started.
          </p>
        </div>
      ) : (
        <RepoGrid repos={repos} onScanComplete={fetchRepos} />
      )}
    </div>
  );
}

/**
 * Groups repos into monorepo parents (with children nested) and standalone repos.
 */
function RepoGrid({ repos, onScanComplete }: { repos: Repo[]; onScanComplete: () => void }) {
  // Build lookup: parentId -> children
  const childrenByParent = new Map<string, Repo[]>();
  const childIds = new Set<string>();

  for (const repo of repos) {
    if (repo.parentRepoId) {
      childIds.add(repo.id);
      const siblings = childrenByParent.get(repo.parentRepoId) ?? [];
      siblings.push(repo);
      childrenByParent.set(repo.parentRepoId, siblings);
    }
  }

  // Top-level repos: those without a parentRepoId
  const topLevel = repos.filter((r) => !r.parentRepoId);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {topLevel.map((repo) => {
          const children = childrenByParent.get(repo.id);
          if (children && children.length > 0) {
            return (
              <MonorepoGroup
                key={repo.id}
                parent={repo}
                children={children}
                onScanComplete={onScanComplete}
              />
            );
          }
          return (
            <RepoHealthCard
              key={repo.id}
              repo={repo}
              onScanComplete={onScanComplete}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Displays a monorepo parent as a card with aggregated score and expandable
 * workspace children nested below.
 */
function MonorepoGroup({
  parent,
  children,
  onScanComplete,
}: {
  parent: Repo;
  children: Repo[];
  onScanComplete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Compute aggregated score: average of all workspace scores that have been scanned
  const scores = children
    .map((c) => c.latestScan?.overallScore)
    .filter((s): s is number => s != null);
  const parentScore = parent.latestScan?.overallScore;
  if (parentScore != null) scores.push(parentScore);
  const aggregatedScore =
    scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  return (
    <div className="col-span-1 md:col-span-2 lg:col-span-3 space-y-2">
      <Card className="border-2 border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              <span className="truncate font-bold">{parent.name}</span>
              <span className="text-xs text-muted-foreground font-normal">
                monorepo &middot; {children.length} workspace{children.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <ScoreGauge score={aggregatedScore} size={56} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                {expanded ? "Collapse" : "Expand"}
              </Button>
            </div>
          </CardTitle>
          <p className="text-xs text-muted-foreground truncate" title={parent.path}>
            {parent.path}
          </p>
        </CardHeader>
        {aggregatedScore != null && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Aggregated health score across all workspaces: <span className="font-medium text-foreground">{aggregatedScore}/100</span>
            </p>
          </CardContent>
        )}
      </Card>
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-6 border-l-2 border-primary/20 ml-4">
          <RepoHealthCard
            key={parent.id}
            repo={parent}
            onScanComplete={onScanComplete}
          />
          {children.map((child) => (
            <RepoHealthCard
              key={child.id}
              repo={child}
              onScanComplete={onScanComplete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BatchProgressBanner({
  progress,
  done,
  onCancel,
}: {
  progress: BatchProgress;
  done: boolean;
  onCancel: () => void;
}) {
  const pct = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!done && (
            <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
          )}
          <span className="text-sm font-medium">
            {done
              ? `Batch scan complete: ${progress.completed} repo${progress.completed === 1 ? "" : "s"} scanned`
              : progress.current
                ? `Scanning ${progress.completed + 1}/${progress.total} repos... (current: ${progress.current})`
                : `Preparing batch scan of ${progress.total} repos...`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {progress.failed > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {progress.failed} failed
            </span>
          )}
          {!done && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          )}
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            done
              ? progress.failed > 0
                ? "bg-amber-500"
                : "bg-green-500"
              : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
