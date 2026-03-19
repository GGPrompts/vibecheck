"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function DashboardPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newRepoPath, setNewRepoPath] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  async function handleAddRepo() {
    if (!newRepoPath.trim()) return;
    setAdding(true);
    setAddError(null);

    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newRepoPath.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAddError(data.error || "Failed to add repository");
        setAdding(false);
        return;
      }

      setNewRepoPath("");
      setDialogOpen(false);
      fetchRepos();
    } catch {
      setAddError("Failed to add repository");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of all registered repositories
          </p>
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {repos.map((repo) => (
            <RepoHealthCard
              key={repo.id}
              repo={repo}
              onScanComplete={fetchRepos}
            />
          ))}
        </div>
      )}
    </div>
  );
}
