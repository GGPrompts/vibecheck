import { resolve } from 'path';
import Graph from 'graphology';
import type { SerializedGraph } from 'graphology-types';
import { detectSourceDirs } from './source-walker';
import { tryDepcruise, buildFromDepcruise } from './depcruise-builder';
import { buildFromRegex } from './regex-builder';
import type { NodeAttrs, EdgeAttrs } from './graph-types';

// Re-export types for consumers that imported them from this module
export type { NodeAttrs, EdgeAttrs } from './graph-types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an import graph for a repository.
 *
 * Tries dependency-cruiser first. If unavailable or fails, falls back to
 * regex-based import parsing.
 *
 * Returns a serialized graphology graph suitable for JSON transport.
 */
export function buildImportGraph(repoPath: string): SerializedGraph<NodeAttrs, EdgeAttrs> {
  const absPath = resolve(repoPath);
  const sourceDirs = detectSourceDirs(absPath);

  if (sourceDirs.length === 0) {
    // Return empty graph
    const empty = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });
    return empty.export();
  }

  // Try depcruise first
  const depcruiseData = tryDepcruise(absPath, sourceDirs);
  let graph: Graph<NodeAttrs, EdgeAttrs>;

  if (depcruiseData) {
    graph = buildFromDepcruise(absPath, depcruiseData);
  } else {
    graph = buildFromRegex(absPath, sourceDirs);
  }

  return graph.export();
}
