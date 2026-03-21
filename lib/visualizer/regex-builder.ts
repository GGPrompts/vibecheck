import { join } from 'path';
import Graph from 'graphology';
import { countLines, walkSourceFiles, parseImports, resolveImport } from './source-walker';
import type { NodeAttrs, EdgeAttrs } from './graph-types';

// ---------------------------------------------------------------------------
// Build graph from regex-based import parsing (fallback)
// ---------------------------------------------------------------------------

export function buildFromRegex(
  repoPath: string,
  sourceDirs: string[],
): Graph<NodeAttrs, EdgeAttrs> {
  const graph = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });

  const files = walkSourceFiles(repoPath, sourceDirs);
  const fileSet = new Set(files);

  // Add all nodes first
  for (const file of files) {
    const fullPath = join(repoPath, file);
    const isEntry = file.startsWith('app/') || file.startsWith('pages/');

    graph.addNode(file, {
      filePath: file,
      loc: countLines(fullPath),
      fanIn: 0,
      fanOut: 0,
      isDynamic: false,
      isIsland: false,
      isEntryPoint: isEntry,
      circularDeps: [],
    });
  }

  // Parse imports and add edges
  for (const file of files) {
    const fullPath = join(repoPath, file);
    const imports = parseImports(fullPath);
    let outCount = 0;

    for (const imp of imports) {
      const resolved = resolveImport(file, imp.specifier, repoPath, fileSet);
      if (!resolved || !graph.hasNode(resolved)) continue;
      if (file === resolved) continue; // self-import
      if (graph.hasEdge(file, resolved)) continue;

      graph.addEdge(file, resolved, {
        isDynamic: imp.isDynamic,
        symbols: imp.symbols,
      });
      outCount++;
    }

    graph.setNodeAttribute(file, 'fanOut', outCount);
  }

  // Calculate fan-in
  graph.forEachEdge((_edge, _attrs, _source, target) => {
    const current = graph.getNodeAttribute(target, 'fanIn');
    graph.setNodeAttribute(target, 'fanIn', current + 1);
  });

  // Detect circular dependencies (simple DFS cycle detection)
  const circularDeps = detectCircularDeps(graph);
  for (const [node, cycles] of circularDeps) {
    if (graph.hasNode(node)) {
      graph.setNodeAttribute(node, 'circularDeps', cycles);
    }
  }

  // Mark islands: fanIn === 0 and not an entry point
  graph.forEachNode((node, attrs) => {
    if (attrs.fanIn === 0 && !attrs.isEntryPoint) {
      graph.setNodeAttribute(node, 'isIsland', true);
    }
  });

  return graph;
}

// ---------------------------------------------------------------------------
// Circular dep detection
// ---------------------------------------------------------------------------

/** Simple DFS-based circular dependency detection. */
function detectCircularDeps(
  graph: Graph<NodeAttrs, EdgeAttrs>,
): Map<string, string[][]> {
  const result = new Map<string, string[][]>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const seenCycles = new Set<string>();

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        const normalized = normalizeCycle(cycle);
        const key = normalized.join(' -> ');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          for (const n of cycle) {
            const existing = result.get(n) ?? [];
            existing.push(normalized);
            result.set(n, existing);
          }
        }
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const neighbors = graph.outNeighbors(node);
    for (const neighbor of neighbors) {
      dfs(neighbor, [...path, node]);
    }

    inStack.delete(node);
  }

  graph.forEachNode((node) => {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  });

  return result;
}

function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) return cycle;
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}
