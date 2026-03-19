"use client";

import { Plus, Trash2, RotateCcw, FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ScanDirsCardProps {
  scanDirs: string[];
  scanDirsDefault: boolean;
  newScanDir: string;
  savingScanDirs: boolean;
  scanDirsSaved: boolean;
  onNewScanDirChange: (value: string) => void;
  onAddScanDir: () => void;
  onRemoveScanDir: (dir: string) => void;
  onSaveScanDirs: () => void;
  onResetScanDirs: () => void;
}

export function ScanDirsCard({
  scanDirs,
  scanDirsDefault,
  newScanDir,
  savingScanDirs,
  scanDirsSaved,
  onNewScanDirChange,
  onAddScanDir,
  onRemoveScanDir,
  onSaveScanDirs,
  onResetScanDirs,
}: ScanDirsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderSearch className="h-5 w-5" />
          Scan Directories
          {scanDirsDefault && (
            <Badge variant="secondary">Defaults</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Directories to scan when discovering repositories. Vibecheck looks for
          projects containing a <code className="text-xs">.git</code> folder or{" "}
          <code className="text-xs">package.json</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current directories list */}
        {scanDirs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scan directories configured.
          </p>
        ) : (
          <div className="space-y-2">
            {scanDirs.map((dir) => (
              <div
                key={dir}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm font-mono truncate" title={dir}>
                  {dir}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemoveScanDir(dir)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add new directory */}
        <div className="flex gap-2">
          <Input
            placeholder="/home/user/projects"
            value={newScanDir}
            onChange={(e) => onNewScanDirChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAddScanDir();
            }}
          />
          <Button
            onClick={onAddScanDir}
            disabled={!newScanDir.trim()}
            size="sm"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            onClick={onSaveScanDirs}
            disabled={savingScanDirs}
            size="sm"
          >
            {savingScanDirs
              ? "Saving..."
              : scanDirsSaved
                ? "Saved!"
                : "Save Directories"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onResetScanDirs}
            disabled={savingScanDirs}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset to Defaults
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
