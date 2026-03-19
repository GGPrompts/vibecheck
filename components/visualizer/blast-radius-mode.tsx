'use client';

import * as React from 'react';
import { useSigma } from '@react-sigma/core';
import { Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ArchitectureAnalysis } from '@/lib/visualizer/architecture';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlastRadiusModeProps {
  active: boolean;
  onToggle: () => void;
  selectedNode: string | null;
  architecture: ArchitectureAnalysis | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * BlastRadiusMode controls a toggle button and, when active + a node is
 * selected, highlights that node's transitive dependents in the Sigma graph.
 *
 * "Dependents" = files that import the selected file (directly or transitively).
 * We walk the graph's in-neighbors (reverse edges) via BFS.
 */
export function BlastRadiusMode({
  active,
  onToggle,
  selectedNode,
  architecture,
}: BlastRadiusModeProps) {
  const sigma = useSigma();
  const originalColorsRef = React.useRef<Map<string, { color: string; size: number }>>(new Map());
  const highlightAppliedRef = React.useRef(false);

  // Snapshot current graph colors (called before applying highlights)
  const snapshotColors = React.useCallback(() => {
    const graph = sigma.getGraph();
    if (graph.order === 0) return;

    const colors = new Map<string, { color: string; size: number }>();
    graph.forEachNode((node, attrs) => {
      colors.set(node, {
        color: (attrs.color as string) ?? '#6366f1',
        size: (attrs.size as number) ?? 5,
      });
    });
    originalColorsRef.current = colors;
  }, [sigma]);

  // Save original colors on first render
  React.useEffect(() => {
    snapshotColors();
  }, [snapshotColors]);

  // Compute affected files via BFS on the sigma graph
  const computeAffectedFiles = React.useCallback(
    (targetNode: string): Set<string> => {
      const graph = sigma.getGraph();
      if (!graph.hasNode(targetNode)) return new Set();

      const visited = new Set<string>();
      const queue: string[] = [];

      // Start from direct in-neighbors (files that import targetNode)
      const inNeighbors = graph.inNeighbors(targetNode);
      for (const n of inNeighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }

      // BFS along reverse edges
      while (queue.length > 0) {
        const current = queue.shift()!;
        const parents = graph.inNeighbors(current);
        for (const p of parents) {
          if (!visited.has(p) && p !== targetNode) {
            visited.add(p);
            queue.push(p);
          }
        }
      }

      return visited;
    },
    [sigma],
  );

  // Apply / reset highlight
  React.useEffect(() => {
    const graph = sigma.getGraph();
    if (graph.order === 0) return;

    if (active && selectedNode) {
      // Re-snapshot current colors before applying highlights
      // so we capture any changes from the time slider
      snapshotColors();
      const affected = computeAffectedFiles(selectedNode);

      graph.forEachNode((node) => {
        if (node === selectedNode) {
          // Selected node: bright white/highlight
          graph.setNodeAttribute(node, 'color', '#ffffff');
          const orig = originalColorsRef.current.get(node);
          graph.setNodeAttribute(node, 'size', (orig?.size ?? 5) * 1.5);
        } else if (affected.has(node)) {
          // Affected: amber/orange highlight
          graph.setNodeAttribute(node, 'color', '#f59e0b');
          const orig = originalColorsRef.current.get(node);
          graph.setNodeAttribute(node, 'size', (orig?.size ?? 5) * 1.2);
        } else {
          // Non-affected: dim
          graph.setNodeAttribute(node, 'color', 'rgba(100, 100, 100, 0.25)');
          const orig = originalColorsRef.current.get(node);
          graph.setNodeAttribute(node, 'size', (orig?.size ?? 5) * 0.7);
        }
      });

      // Dim non-affected edges
      graph.forEachEdge((edge, _attrs, source, target) => {
        const sourceAffected =
          source === selectedNode || affected.has(source);
        const targetAffected =
          target === selectedNode || affected.has(target);
        if (sourceAffected && targetAffected) {
          graph.setEdgeAttribute(edge, 'color', 'rgba(245, 158, 11, 0.5)');
          graph.setEdgeAttribute(edge, 'size', 1.5);
        } else {
          graph.setEdgeAttribute(edge, 'color', 'rgba(100, 100, 100, 0.05)');
          graph.setEdgeAttribute(edge, 'size', 0.3);
        }
      });

      highlightAppliedRef.current = true;
    } else if (highlightAppliedRef.current) {
      // Reset to original colors
      graph.forEachNode((node) => {
        const orig = originalColorsRef.current.get(node);
        if (orig) {
          graph.setNodeAttribute(node, 'color', orig.color);
          graph.setNodeAttribute(node, 'size', orig.size);
        }
      });

      // Reset edge colors
      graph.forEachEdge((edge, attrs) => {
        const isCircular = (attrs.isCircular as boolean) ?? false;
        graph.setEdgeAttribute(
          edge,
          'color',
          isCircular ? 'rgba(239, 68, 68, 0.7)' : 'rgba(150, 150, 150, 0.15)',
        );
        graph.setEdgeAttribute(edge, 'size', isCircular ? 2 : 0.5);
      });

      highlightAppliedRef.current = false;
    }
  }, [active, selectedNode, sigma, computeAffectedFiles, snapshotColors]);

  // Count for display
  const affectedCount = React.useMemo(() => {
    if (!active || !selectedNode) return 0;
    // Use architecture data if available, otherwise compute
    if (architecture?.blastRadius) {
      const entry = architecture.blastRadius.find((b) => b.file === selectedNode);
      if (entry) return entry.transitiveDependents;
    }
    return computeAffectedFiles(selectedNode).size;
  }, [active, selectedNode, architecture, computeAffectedFiles]);

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={active ? 'default' : 'ghost'}
        size="sm"
        className={`text-xs gap-1.5 ${active ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}`}
        onClick={onToggle}
        title="Toggle blast radius mode"
      >
        <Zap className="size-3.5" />
        Blast Radius
      </Button>
      {active && selectedNode && affectedCount > 0 && (
        <div className="text-xs text-amber-400 font-medium px-1 text-center">
          {affectedCount} {affectedCount === 1 ? 'file' : 'files'} affected
        </div>
      )}
    </div>
  );
}
