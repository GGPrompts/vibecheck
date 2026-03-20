'use client';

import * as React from 'react';
import { X, FileCode, ArrowUpRight, ArrowDownLeft, Layers, Zap, ExternalLink, GitBranch, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { FileHealthData } from '@/lib/visualizer/file-health';
import type { ArchLayer, BlastRadiusEntry } from '@/lib/visualizer/architecture';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectedNodeData {
  filePath: string;
  health: FileHealthData | null;
  loc: number;
  fanIn: number;
  fanOut: number;
  layer: ArchLayer | null;
  blastRadius: BlastRadiusEntry | null;
}

interface FileSidebarProps {
  node: SelectedNodeData | null;
  onClose: () => void;
  githubUrl?: string | null;
  defaultBranch?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function healthColor(score: number): string {
  if (score <= 40) return 'text-red-400';
  if (score <= 70) return 'text-yellow-400';
  return 'text-green-400';
}

function healthBg(score: number): string {
  if (score <= 40) return 'bg-red-500/10 border-red-500/30';
  if (score <= 70) return 'bg-yellow-500/10 border-yellow-500/30';
  return 'bg-green-500/10 border-green-500/30';
}

function severityBadgeColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-600/20 text-red-400 border-red-500/30';
    case 'high':
      return 'bg-orange-600/20 text-orange-400 border-orange-500/30';
    case 'medium':
      return 'bg-yellow-600/20 text-yellow-400 border-yellow-500/30';
    case 'low':
      return 'bg-blue-600/20 text-blue-400 border-blue-500/30';
    case 'info':
      return 'bg-zinc-600/20 text-zinc-400 border-zinc-500/30';
    default:
      return 'bg-zinc-600/20 text-zinc-400 border-zinc-500/30';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileSidebar({ node, onClose, githubUrl, defaultBranch = 'main' }: FileSidebarProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    if (!node) return;

    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    // Delay listener to prevent immediate close from the same click that opened
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [node, onClose]);

  // Close on Escape
  React.useEffect(() => {
    if (!node) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [node, onClose]);

  return (
    <div
      ref={panelRef}
      className={`absolute top-0 right-0 h-full w-80 z-30 transform transition-transform duration-200 ease-out ${
        node ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="h-full bg-background/95 backdrop-blur-md border-l border-border shadow-2xl overflow-y-auto">
        {node && (
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <FileCode className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-foreground break-all leading-tight">
                  {node.filePath}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={onClose}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            {/* GitHub Links */}
            {githubUrl && (
              <div className="flex gap-1.5">
                <a
                  href={`${githubUrl}/blob/${defaultBranch}/${node.filePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <ExternalLink className="size-3" />
                  View
                </a>
                <a
                  href={`${githubUrl}/blame/${defaultBranch}/${node.filePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <GitBranch className="size-3" />
                  Blame
                </a>
                <a
                  href={`${githubUrl}/commits/${defaultBranch}/${node.filePath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <History className="size-3" />
                  History
                </a>
              </div>
            )}

            {/* Health Score */}
            {node.health && (
              <div className={`rounded-lg border p-3 ${healthBg(node.health.health)}`}>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">
                  Health Score
                </p>
                <p className={`text-2xl font-bold tabular-nums ${healthColor(node.health.health)}`}>
                  {node.health.health}
                  <span className="text-sm font-normal text-muted-foreground ml-1">/ 100</span>
                </p>
              </div>
            )}

            {/* File Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted/50 border border-border p-2 text-center">
                <p className="text-xs text-muted-foreground">LOC</p>
                <p className="text-sm font-semibold text-foreground tabular-nums">{node.loc}</p>
              </div>
              <div className="rounded-lg bg-muted/50 border border-border p-2 text-center">
                <div className="flex items-center justify-center gap-0.5">
                  <ArrowDownLeft className="size-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Fan-in</p>
                </div>
                <p className="text-sm font-semibold text-foreground tabular-nums">{node.fanIn}</p>
              </div>
              <div className="rounded-lg bg-muted/50 border border-border p-2 text-center">
                <div className="flex items-center justify-center gap-0.5">
                  <ArrowUpRight className="size-3 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Fan-out</p>
                </div>
                <p className="text-sm font-semibold text-foreground tabular-nums">{node.fanOut}</p>
              </div>
            </div>

            {/* Layer */}
            {node.layer && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Layers className="size-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    Layer
                  </p>
                </div>
                <Badge variant="secondary">{node.layer}</Badge>
              </div>
            )}

            {/* Findings Summary */}
            {node.health && node.health.findingCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  Findings ({node.health.findingCount})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(node.health.severityCounts).map(([severity, count]) =>
                    count > 0 ? (
                      <span
                        key={severity}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${severityBadgeColor(severity)}`}
                      >
                        {count} {severity}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            )}

            {/* Blast Radius */}
            {node.blastRadius && node.blastRadius.transitiveDependents > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Zap className="size-3.5 text-amber-400" />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                    Blast Radius
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  Changes may affect{' '}
                  <span className="font-semibold text-amber-400">
                    {node.blastRadius.transitiveDependents}
                  </span>{' '}
                  {node.blastRadius.transitiveDependents === 1 ? 'file' : 'files'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {node.blastRadius.directDependents} direct{' '}
                  {node.blastRadius.directDependents === 1 ? 'dependent' : 'dependents'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
