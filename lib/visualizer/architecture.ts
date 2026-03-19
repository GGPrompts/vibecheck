import Graph from 'graphology';
import type { SerializedGraph } from 'graphology-types';
import louvain from 'graphology-communities-louvain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArchLayer = 'UI' | 'API' | 'Business' | 'Data' | 'Utils' | 'Infra' | 'Unknown';

export interface FeatureArea {
  id: number;
  name: string;
  files: string[];
  cohesion: number; // ratio of internal edges to total edges touching this cluster
}

export interface LayerViolation {
  source: string;
  target: string;
  sourceLayer: ArchLayer;
  targetLayer: ArchLayer;
  reason: string;
}

export interface CouplingPair {
  communityA: number;
  communityB: number;
  nameA: string;
  nameB: string;
  crossEdges: number;
}

export interface BlastRadiusEntry {
  file: string;
  directDependents: number;
  transitiveDependents: number;
}

export interface ArchitectureAnalysis {
  featureAreas: FeatureArea[];
  layers: Record<string, ArchLayer>;
  layerViolations: LayerViolation[];
  coupling: CouplingPair[];
  blastRadius: BlastRadiusEntry[];
  summary: {
    totalNodes: number;
    totalEdges: number;
    communityCount: number;
    violationCount: number;
    avgCohesion: number;
    highBlastRadiusFiles: string[]; // top files by transitive dependents
  };
}

// ---------------------------------------------------------------------------
// Layer classification
// ---------------------------------------------------------------------------

/**
 * Forbidden imports: source layer -> set of layers it should NOT import from.
 *
 * - UI should not directly import Data (skip Business/API)
 * - Utils should not import Business (utils should be pure helpers)
 * - Data should not import UI
 * - Infra should not import UI
 */
const LAYER_VIOLATIONS: Record<ArchLayer, Set<ArchLayer>> = {
  UI: new Set<ArchLayer>(['Data']),
  API: new Set<ArchLayer>(),
  Business: new Set<ArchLayer>(),
  Data: new Set<ArchLayer>(['UI']),
  Utils: new Set<ArchLayer>(['Business', 'UI', 'API']),
  Infra: new Set<ArchLayer>(['UI']),
  Unknown: new Set<ArchLayer>(),
};

function classifyLayer(filePath: string, roles: string[]): ArchLayer {
  const p = filePath.replace(/\\/g, '/');

  // Role-based classification takes priority
  if (roles.includes('api-route')) return 'API';
  if (roles.includes('ui-kit')) return 'UI';
  if (roles.includes('cli-entrypoint') || roles.includes('mcp-tool')) return 'Infra';

  // Path-based heuristics
  if (p.startsWith('app/api/') || p.startsWith('pages/api/')) return 'API';
  if (
    p.startsWith('app/') ||
    p.startsWith('pages/') ||
    p.startsWith('components/') ||
    p.startsWith('src/components/') ||
    p.startsWith('src/app/')
  ) return 'UI';
  if (
    p.startsWith('db/') ||
    p.startsWith('drizzle/') ||
    p.startsWith('prisma/') ||
    p.startsWith('src/db/') ||
    p.startsWith('lib/db/') ||
    p.startsWith('src/lib/db/')
  ) return 'Data';
  if (
    p.startsWith('lib/') ||
    p.startsWith('src/lib/') ||
    p.startsWith('services/') ||
    p.startsWith('src/services/')
  ) return 'Business';
  if (
    p.startsWith('utils/') ||
    p.startsWith('helpers/') ||
    p.startsWith('src/utils/') ||
    p.startsWith('src/helpers/')
  ) return 'Utils';
  if (
    p.startsWith('bin/') ||
    p.startsWith('mcp-server/') ||
    p.startsWith('scripts/') ||
    p.startsWith('src/bin/')
  ) return 'Infra';

  return 'Unknown';
}

// ---------------------------------------------------------------------------
// Community naming
// ---------------------------------------------------------------------------

/**
 * Name a community by its dominant directory prefix.
 * Picks the most common first two path segments.
 */
function nameCommunity(files: string[]): string {
  const prefixCounts = new Map<string, number>();

  for (const f of files) {
    const parts = f.replace(/\\/g, '/').split('/');
    // Use up to first 2 segments as prefix
    const prefix = parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : parts[0];
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  let bestPrefix = 'misc';
  let bestCount = 0;
  for (const [prefix, count] of prefixCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestPrefix = prefix;
    }
  }

  return bestPrefix;
}

// ---------------------------------------------------------------------------
// BFS for blast radius (reverse edges — who depends on this file)
// ---------------------------------------------------------------------------

function computeBlastRadius(
  graph: Graph,
): Map<string, { direct: number; transitive: number }> {
  const result = new Map<string, { direct: number; transitive: number }>();

  graph.forEachNode((node) => {
    // Direct dependents = in-degree (who imports this file)
    const directDeps = graph.inDegree(node);

    // BFS along reverse edges to find transitive dependents
    const visited = new Set<string>();
    const queue: string[] = [];

    // Start from all direct importers
    const inNeighbors = graph.inNeighbors(node);
    for (const n of inNeighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const parents = graph.inNeighbors(current);
      for (const p of parents) {
        if (!visited.has(p) && p !== node) {
          visited.add(p);
          queue.push(p);
        }
      }
    }

    result.set(node, {
      direct: directDeps,
      transitive: visited.size,
    });
  });

  return result;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export function analyzeArchitecture(
  serializedGraph: SerializedGraph,
  fileRoles?: Map<string, string[]>,
): ArchitectureAnalysis {
  // Reconstruct graphology instance from serialized data
  const graph = new Graph({ type: 'directed', multi: false });
  // Import safely — the serialized graph may have options/attributes that
  // conflict with our constructor options, so we import nodes + edges only.
  for (const node of serializedGraph.nodes) {
    if (!graph.hasNode(node.key)) {
      graph.addNode(node.key, node.attributes ?? {});
    }
  }
  for (const edge of serializedGraph.edges) {
    if (!graph.hasEdge(edge.source, edge.target)) {
      graph.addEdge(edge.source, edge.target, edge.attributes ?? {});
    }
  }

  const roles = fileRoles ?? new Map<string, string[]>();

  // ── 1. Layer classification ──────────────────────────────────────────
  const layers: Record<string, ArchLayer> = {};
  graph.forEachNode((node) => {
    layers[node] = classifyLayer(node, roles.get(node) ?? []);
  });

  // ── 2. Community detection ───────────────────────────────────────────
  // Louvain requires at least one edge; fall back to directory grouping if
  // the graph is too sparse.
  let communityMap: Record<string, number>;
  let communityCount: number;

  if (graph.order > 0 && graph.size > 0) {
    try {
      // Create an undirected copy for Louvain (it works on undirected or
      // directed, but undirected often gives more meaningful communities
      // for import graphs since the relationship is bidirectional).
      const result = louvain.detailed(graph);
      communityMap = result.communities;
      communityCount = result.count;
    } catch {
      // Fallback: directory-based clustering
      ({ communityMap, communityCount } = directoryBasedClustering(graph));
    }
  } else {
    ({ communityMap, communityCount } = directoryBasedClustering(graph));
  }

  // ── 3. Build feature areas ───────────────────────────────────────────
  const communityFiles = new Map<number, string[]>();
  for (const [node, cid] of Object.entries(communityMap)) {
    const list = communityFiles.get(cid) ?? [];
    list.push(node);
    communityFiles.set(cid, list);
  }

  const featureAreas: FeatureArea[] = [];
  for (const [cid, files] of communityFiles) {
    const cohesion = computeCohesion(graph, new Set(files));
    featureAreas.push({
      id: cid,
      name: nameCommunity(files),
      files,
      cohesion,
    });
  }

  // Sort by file count descending
  featureAreas.sort((a, b) => b.files.length - a.files.length);

  // ── 4. Layer violations ──────────────────────────────────────────────
  const layerViolations: LayerViolation[] = [];
  graph.forEachEdge((_edge, _attrs, source, target) => {
    const srcLayer = layers[source];
    const tgtLayer = layers[target];
    if (srcLayer && tgtLayer && LAYER_VIOLATIONS[srcLayer]?.has(tgtLayer)) {
      layerViolations.push({
        source,
        target,
        sourceLayer: srcLayer,
        targetLayer: tgtLayer,
        reason: `${srcLayer} should not import directly from ${tgtLayer}`,
      });
    }
  });

  // ── 5. Cross-community coupling ─────────────────────────────────────
  const couplingCounts = new Map<string, number>();
  graph.forEachEdge((_edge, _attrs, source, target) => {
    const cA = communityMap[source];
    const cB = communityMap[target];
    if (cA !== undefined && cB !== undefined && cA !== cB) {
      const key = cA < cB ? `${cA}:${cB}` : `${cB}:${cA}`;
      couplingCounts.set(key, (couplingCounts.get(key) ?? 0) + 1);
    }
  });

  // Build a name lookup for communities
  const communityNames = new Map<number, string>();
  for (const fa of featureAreas) {
    communityNames.set(fa.id, fa.name);
  }

  const coupling: CouplingPair[] = [];
  for (const [key, count] of couplingCounts) {
    const [aStr, bStr] = key.split(':');
    const a = Number(aStr);
    const b = Number(bStr);
    coupling.push({
      communityA: a,
      communityB: b,
      nameA: communityNames.get(a) ?? `community-${a}`,
      nameB: communityNames.get(b) ?? `community-${b}`,
      crossEdges: count,
    });
  }

  // Sort by cross-edge count descending
  coupling.sort((a, b) => b.crossEdges - a.crossEdges);

  // ── 6. Blast radius ─────────────────────────────────────────────────
  const blastMap = computeBlastRadius(graph);
  const blastRadius: BlastRadiusEntry[] = [];
  for (const [file, { direct, transitive }] of blastMap) {
    blastRadius.push({
      file,
      directDependents: direct,
      transitiveDependents: transitive,
    });
  }

  // Sort by transitive dependents descending
  blastRadius.sort((a, b) => b.transitiveDependents - a.transitiveDependents);

  // ── 7. Summary ──────────────────────────────────────────────────────
  const avgCohesion =
    featureAreas.length > 0
      ? featureAreas.reduce((sum, fa) => sum + fa.cohesion, 0) / featureAreas.length
      : 0;

  const highBlastRadiusFiles = blastRadius
    .slice(0, 10)
    .filter((b) => b.transitiveDependents > 0)
    .map((b) => b.file);

  return {
    featureAreas,
    layers,
    layerViolations,
    coupling,
    blastRadius,
    summary: {
      totalNodes: graph.order,
      totalEdges: graph.size,
      communityCount,
      violationCount: layerViolations.length,
      avgCohesion: Math.round(avgCohesion * 1000) / 1000,
      highBlastRadiusFiles,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cohesion: ratio of internal edges to total edges touching the community.
 * Internal edge = both endpoints in the community.
 * Total = internal + boundary (one endpoint in, one out).
 */
function computeCohesion(graph: Graph, members: Set<string>): number {
  let internal = 0;
  let boundary = 0;

  graph.forEachEdge((_edge, _attrs, source, target) => {
    const srcIn = members.has(source);
    const tgtIn = members.has(target);
    if (srcIn && tgtIn) {
      internal++;
    } else if (srcIn || tgtIn) {
      boundary++;
    }
  });

  const total = internal + boundary;
  if (total === 0) return 1; // isolated cluster with no edges = perfectly cohesive
  return internal / total;
}

/**
 * Fallback clustering when Louvain is unavailable or the graph is too sparse.
 * Groups nodes by their top-level directory.
 */
function directoryBasedClustering(graph: Graph): {
  communityMap: Record<string, number>;
  communityCount: number;
} {
  const dirToCommunity = new Map<string, number>();
  const communityMap: Record<string, number> = {};
  let nextId = 0;

  graph.forEachNode((node) => {
    const parts = node.replace(/\\/g, '/').split('/');
    const dir = parts.length >= 2 ? parts[0] : '.';

    if (!dirToCommunity.has(dir)) {
      dirToCommunity.set(dir, nextId++);
    }
    communityMap[node] = dirToCommunity.get(dir)!;
  });

  return { communityMap, communityCount: nextId };
}
