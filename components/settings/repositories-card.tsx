"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Repo } from "./types";

interface RepositoriesCardProps {
  repos: Repo[];
  dialogOpen: boolean;
  newRepoPath: string;
  addError: string | null;
  adding: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onNewRepoPathChange: (value: string) => void;
  onAddRepo: () => void;
  onDeleteRepo: (id: string) => void;
}

export function RepositoriesCard({
  repos,
  dialogOpen,
  newRepoPath,
  addError,
  adding,
  onDialogOpenChange,
  onNewRepoPathChange,
  onAddRepo,
  onDeleteRepo,
}: RepositoriesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Repositories</span>
          <Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
            <DialogTrigger
              render={
                <Button size="sm">
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
                <Label htmlFor="settings-repo-path">Repository Path</Label>
                <Input
                  id="settings-repo-path"
                  placeholder="/home/user/projects/my-repo"
                  value={newRepoPath}
                  onChange={(e) => onNewRepoPathChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onAddRepo();
                  }}
                />
                {addError && (
                  <p className="text-xs text-destructive">{addError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={onAddRepo}
                  disabled={adding || !newRepoPath.trim()}
                >
                  {adding ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardTitle>
        <CardDescription>
          Manage the repositories tracked by Vibecheck.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repositories added yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Last Scan</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((repo) => (
                <TableRow key={repo.id}>
                  <TableCell className="font-medium">{repo.name}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground" title={repo.path}>
                    {repo.path}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {repo.latestScan?.createdAt
                      ? new Date(repo.latestScan.createdAt).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      onClick={() => onDeleteRepo(repo.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
