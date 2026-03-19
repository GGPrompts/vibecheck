'use client';

import * as React from 'react';
import Graph from 'graphology';
import type { SerializedGraph } from 'graphology-types';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { SigmaContainer, useLoadGraph, useSigma, useRegisterEvents } from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { GraphControls } from './graph-controls';
import { FileSidebar, type SelectedNodeData } from './file-sidebar';
import { BlastRadiusMode } from './blast-radius-mode';
import { FilterPanel, type FilterState } from './filter-panel';
import { TimeSlider } from './time-slider';
import type { FileHealthMap } from '@/lib/visualizer/file-health';
import type { ArchitectureAnalysis, ArchLayer } from '@/lib/visualizer/architecture';

// ---------------------------------------------------------------------------
// Health -> color helper
// ---------------------------------------------------------------------------

/**
 * Interpolate a health score (0-100) to a hex color:
 *   0-40:  red (#ef4444) -> yellow (#eab308)
 *   40-70: yellow (#eab308) -> green (#22c55e)
 *   70-100: green stays (#22c55e)
 */
export function healthToColor(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));

  if (clamped <= 40) {
    // red to yellow
    const t = clamped / 40;
    const r = Math.round(239 + (234 - 239) * t);
    const g = Math.round(68 + (179 - 68) * t);
    const b = Math.round(68 + (8 - 68) * t);
    return `rgb(${r},${g},${b})`;
  }

  if (clamped <= 70) {
    // yellow to green
    const t = (clamped - 40) / 30;
    const r = Math.round(234 + (34 - 234) * t);
    const g = Math.round(179 + (197 - 179) * t);
    const b = Math.round(8 + (94 - 8) * t);
    return `rgb(${r},${g},${b})`;
  }

  // green
  return 'rgb(34,197,94)';
}

// Default color for nodes with no health data
export const DEFAULT_NODE_COLOR = '#6366f1'; // indigo-500

// ---------------------------------------------------------------------------
// Event handler component (must live inside SigmaContainer)
// ---------------------------------------------------------------------------

interface GraphEventsProps {
  healthMap: FileHealthMap;
  architecture: ArchitectureAnalysis | null;
  onNodeClick: (data: SelectedNodeData) => void;
  onStageClick: () => void;
}

function GraphEvents({ healthMap, architecture, onNodeClick, onStageClick }: GraphEventsProps) {
  const sigma = useSigma();
  const registerEvents = useRegisterEvents();

  React.useEffect(() => {
    registerEvents({
      clickNode: (event) => {
        const node = event.node;
        const graph = sigma.getGraph();
        if (!graph.hasNode(node)) return;

        const attrs = graph.getNodeAttributes(node);
        const fileHealth = healthMap[node] ?? null;
        const layer: ArchLayer | null = architecture?.layers?.[node] ?? null;
        const blastRadius =
          architecture?.blastRadius?.find((b) => b.file === node) ?? null;

        const fanIn = graph.inDegree(node);
        const fanOut = graph.outDegree(node);
        const loc = (attrs.loc as number) ?? 0;

        onNodeClick({
          filePath: node,
          health: fileHealth,
          loc,
          fanIn,
          fanOut,
          layer,
          blastRadius,
        });
      },
      clickStage: () => {
        onStageClick();
      },
    });
  }, [sigma, registerEvents, healthMap, architecture, onNodeClick, onStageClick]);

  return null;
}

// ---------------------------------------------------------------------------
// Inner component that loads the graph into Sigma
// ---------------------------------------------------------------------------

interface GraphLoaderProps {
  serializedGraph: SerializedGraph;
  healthMap: FileHealthMap;
  architecture: ArchitectureAnalysis | null;
}

function GraphLoader({
  serializedGraph,
  healthMap,
  architecture,
}: GraphLoaderProps) {
  const loadGraph = useLoadGraph();
  const sigma = useSigma();
  const graphLoadedRef = React.useRef(false);

  React.useEffect(() => {
    if (graphLoadedRef.current) return;
    graphLoadedRef.current = true;

    // Build a graphology Graph from serialized data
    const graph = new Graph({ type: 'directed', multi: false });

    for (const node of serializedGraph.nodes) {
      if (!graph.hasNode(node.key)) {
        graph.addNode(node.key, { ...(node.attributes ?? {}) });
      }
    }

    for (const edge of serializedGraph.edges) {
      if (
        graph.hasNode(edge.source) &&
        graph.hasNode(edge.target) &&
        !graph.hasEdge(edge.source, edge.target)
      ) {
        graph.addEdge(edge.source, edge.target, { ...(edge.attributes ?? {}) });
      }
    }

    // Apply file health as node colors and sizes
    graph.forEachNode((node, attrs) => {
      const loc = (attrs.loc as number) ?? 10;
      const size = Math.max(3, Math.log2(loc + 1) * 3);

      const fileHealth = healthMap[node];
      const color = fileHealth
        ? healthToColor(fileHealth.health)
        : DEFAULT_NODE_COLOR;

      // Apply architecture layer as label suffix
      let label = node;
      if (architecture?.layers?.[node]) {
        label = `${node} [${architecture.layers[node]}]`;
      }

      graph.setNodeAttribute(node, 'size', size);
      graph.setNodeAttribute(node, 'color', color);
      graph.setNodeAttribute(node, 'label', label);

      // Store community for potential coloring
      if (architecture?.featureAreas) {
        for (const area of architecture.featureAreas) {
          if (area.files.includes(node)) {
            graph.setNodeAttribute(node, 'community', area.id);
            graph.setNodeAttribute(node, 'communityName', area.name);
            break;
          }
        }
      }
    });

    // Mark circular dep edges
    graph.forEachEdge((edge, attrs, source, target) => {
      const srcAttrs = graph.getNodeAttributes(source);
      const circularDeps = (srcAttrs.circularDeps as string[][]) ?? [];
      const isCircular = circularDeps.some(
        (cycle) => cycle.includes(source) && cycle.includes(target),
      );

      if (isCircular || attrs.isDynamic === false) {
        // Check if part of any circular dependency
      }

      graph.setEdgeAttribute(edge, 'color', isCircular ? 'rgba(239, 68, 68, 0.7)' : 'rgba(150, 150, 150, 0.15)');
      graph.setEdgeAttribute(edge, 'size', isCircular ? 2 : 0.5);
    });

    // Assign random initial positions (needed for ForceAtlas2)
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'x', Math.random() * 100);
      graph.setNodeAttribute(node, 'y', Math.random() * 100);
    });

    // Run ForceAtlas2 layout synchronously for initial positioning
    if (graph.order > 0 && graph.size > 0) {
      try {
        const settings = forceAtlas2.inferSettings(graph);
        forceAtlas2.assign(graph, {
          iterations: 100,
          settings: {
            ...settings,
            barnesHutOptimize: graph.order > 500,
          },
        });
      } catch {
        // Layout failed — positions will remain random, which is still usable
      }
    }

    // Load the graph into Sigma
    loadGraph(graph);

    // Reset camera to fit view after a short delay to allow render
    setTimeout(() => {
      try {
        const camera = sigma.getCamera();
        camera.animatedReset({ duration: 300 });
      } catch {
        // Camera reset is best-effort
      }
    }, 100);
  }, [serializedGraph, healthMap, architecture, loadGraph, sigma]);

  return null;
}

// ---------------------------------------------------------------------------
// Main export: GraphRenderer
// ---------------------------------------------------------------------------

interface GraphRendererProps {
  serializedGraph: SerializedGraph;
  healthMap: FileHealthMap;
  architecture: ArchitectureAnalysis | null;
  repoId?: string;
}

export function GraphRenderer({
  serializedGraph,
  healthMap,
  architecture,
  repoId,
}: GraphRendererProps) {
  const nodeCount = serializedGraph.nodes.length;
  const edgeCount = serializedGraph.edges.length;

  // Interactive state
  const [selectedNode, setSelectedNode] = React.useState<SelectedNodeData | null>(null);
  const [blastRadiusActive, setBlastRadiusActive] = React.useState(false);
  const [filters, setFilters] = React.useState<FilterState>({
    healthColors: new Set(),
    layers: new Set(),
    searchQuery: '',
  });

  // Active health map — starts as the prop, changes when time slider scrubs
  const [activeHealthMap, setActiveHealthMap] = React.useState<FileHealthMap>(healthMap);

  // Keep activeHealthMap in sync if the prop changes (e.g. on refresh)
  React.useEffect(() => {
    setActiveHealthMap(healthMap);
  }, [healthMap]);

  // Time slider callback: update active health map
  const handleTimeHealthChange = React.useCallback(
    (newHealthMap: FileHealthMap, _scanId: string | null, _overallScore: number | null) => {
      setActiveHealthMap(newHealthMap);
    },
    [],
  );

  const handleNodeClick = React.useCallback((data: SelectedNodeData) => {
    setSelectedNode(data);
  }, []);

  const handleStageClick = React.useCallback(() => {
    // Only dismiss sidebar if blast radius mode is off
    if (!blastRadiusActive) {
      setSelectedNode(null);
    }
  }, [blastRadiusActive]);

  const handleSidebarClose = React.useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleBlastRadiusToggle = React.useCallback(() => {
    setBlastRadiusActive((prev) => {
      if (prev) {
        // Turning off — also clear selection
        setSelectedNode(null);
      }
      return !prev;
    });
  }, []);

  if (nodeCount === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No nodes in graph. Run a scan to populate the import graph.
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <SigmaContainer
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        settings={{
          defaultNodeColor: DEFAULT_NODE_COLOR,
          defaultEdgeColor: 'rgba(150, 150, 150, 0.15)',
          labelFont: 'var(--font-geist-sans, sans-serif)',
          labelSize: 11,
          labelWeight: '500',
          labelColor: { color: '#a1a1aa' },
          renderEdgeLabels: false,
          enableEdgeEvents: false,
          labelRenderedSizeThreshold: 8,
          zIndex: true,
        }}
      >
        <GraphLoader
          serializedGraph={serializedGraph}
          healthMap={healthMap}
          architecture={architecture}
        />
        <GraphEvents
          healthMap={activeHealthMap}
          architecture={architecture}
          onNodeClick={handleNodeClick}
          onStageClick={handleStageClick}
        />
        <GraphControls nodeCount={nodeCount} edgeCount={edgeCount}>
          <BlastRadiusMode
            active={blastRadiusActive}
            onToggle={handleBlastRadiusToggle}
            selectedNode={selectedNode?.filePath ?? null}
            architecture={architecture}
          />
        </GraphControls>
        <FilterPanel
          healthMap={activeHealthMap}
          architecture={architecture}
          filters={filters}
          onFiltersChange={setFilters}
        />
        {repoId && (
          <TimeSlider
            repoId={repoId}
            currentHealthMap={healthMap}
            onHealthMapChange={handleTimeHealthChange}
          />
        )}
      </SigmaContainer>

      {/* File sidebar renders outside SigmaContainer to overlay the canvas */}
      <FileSidebar node={selectedNode} onClose={handleSidebarClose} />
    </div>
  );
}
