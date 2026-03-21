'use client';

import * as React from 'react';
import { useSigma } from '@react-sigma/core';
import { Filter, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FileHealthMap } from '@/lib/visualizer/file-health';
import type { ArchLayer, ArchitectureAnalysis } from '@/lib/visualizer/architecture';
import { SearchFilter, HealthFilter, LayerFilter } from './filter-sections';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterState {
  healthColors: Set<'red' | 'yellow' | 'green'>;
  layers: Set<ArchLayer>;
  searchQuery: string;
}

interface FilterPanelProps {
  healthMap: FileHealthMap;
  architecture: ArchitectureAnalysis | null;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FilterPanel({
  healthMap,
  architecture,
  filters,
  onFiltersChange,
}: FilterPanelProps) {
  const sigma = useSigma();
  const [collapsed, setCollapsed] = React.useState(false);
  const originalColorsRef = React.useRef<Map<string, { color: string; size: number }>>(new Map());

  // Snapshot original node attributes on mount and when healthMap changes
  React.useEffect(() => {
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
  }, [sigma, healthMap]);

  // Determine if a node matches the current filters
  const nodeMatchesFilters = React.useCallback(
    (node: string): boolean => {
      const { healthColors, layers, searchQuery } = filters;

      const hasHealthFilter = healthColors.size > 0;
      const hasLayerFilter = layers.size > 0;
      const hasSearchFilter = searchQuery.trim().length > 0;

      if (!hasHealthFilter && !hasLayerFilter && !hasSearchFilter) return true;

      if (hasHealthFilter) {
        const fileHealth = healthMap[node];
        if (!fileHealth || !healthColors.has(fileHealth.color)) return false;
      }

      if (hasLayerFilter) {
        const layer = architecture?.layers?.[node];
        if (!layer || !layers.has(layer)) return false;
      }

      if (hasSearchFilter) {
        if (!node.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false;
      }

      return true;
    },
    [filters, healthMap, architecture],
  );

  // Apply filter dimming to the graph
  React.useEffect(() => {
    const graph = sigma.getGraph();
    if (graph.order === 0) return;

    const { healthColors, layers, searchQuery } = filters;
    const hasAnyFilter =
      healthColors.size > 0 || layers.size > 0 || searchQuery.trim().length > 0;

    if (!hasAnyFilter) {
      restoreOriginalColors(graph, originalColorsRef.current);
      return;
    }

    const matchingNodes = applyNodeDimming(graph, nodeMatchesFilters, originalColorsRef.current);
    applyEdgeDimming(graph, matchingNodes);

    if (searchQuery.trim().length > 0 && matchingNodes.size > 0 && matchingNodes.size <= 50) {
      zoomToMatchingNodes(sigma, graph, matchingNodes);
    }
  }, [filters, sigma, nodeMatchesFilters]);

  // Handlers
  const toggleHealthColor = (color: 'red' | 'yellow' | 'green') => {
    const next = new Set(filters.healthColors);
    if (next.has(color)) next.delete(color);
    else next.add(color);
    onFiltersChange({ ...filters, healthColors: next });
  };

  const toggleLayer = (layer: ArchLayer) => {
    const next = new Set(filters.layers);
    if (next.has(layer)) next.delete(layer);
    else next.add(layer);
    onFiltersChange({ ...filters, layers: next });
  };

  const hasActiveFilters =
    filters.healthColors.size > 0 ||
    filters.layers.size > 0 ||
    filters.searchQuery.trim().length > 0;

  const clearAll = () => {
    onFiltersChange({
      healthColors: new Set(),
      layers: new Set(),
      searchQuery: '',
    });
  };

  return (
    <div
      className={`absolute top-3 left-3 z-10 transition-all duration-200 ease-out ${
        collapsed ? 'w-10' : 'w-52'
      }`}
    >
      {collapsed ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-10 bg-background/80 backdrop-blur-sm border border-border shadow-md rounded-lg"
          onClick={() => setCollapsed(false)}
          title="Show filters"
        >
          <div className="relative">
            <Filter className="size-4" />
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber-400" />
            )}
          </div>
        </Button>
      ) : (
        <div className="bg-background/80 backdrop-blur-sm rounded-lg border border-border shadow-md">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-1.5">
              <Filter className="size-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                Filters
              </span>
            </div>
            <div className="flex items-center gap-1">
              {hasActiveFilters && (
                <button
                  className="text-[10px] text-amber-400 hover:text-amber-300 font-medium"
                  onClick={clearAll}
                >
                  Clear
                </button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setCollapsed(true)}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="p-3 space-y-3">
            <SearchFilter
              searchQuery={filters.searchQuery}
              onSearchChange={(query) => onFiltersChange({ ...filters, searchQuery: query })}
            />
            <HealthFilter
              healthColors={filters.healthColors}
              onToggle={toggleHealthColor}
            />
            <LayerFilter
              architecture={architecture}
              layers={filters.layers}
              onToggle={toggleLayer}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph manipulation helpers
// ---------------------------------------------------------------------------

function restoreOriginalColors(
  graph: ReturnType<ReturnType<typeof useSigma>['getGraph']>,
  originalColors: Map<string, { color: string; size: number }>,
): void {
  graph.forEachNode((node) => {
    const orig = originalColors.get(node);
    if (orig) {
      graph.setNodeAttribute(node, 'color', orig.color);
      graph.setNodeAttribute(node, 'size', orig.size);
    }
  });
  graph.forEachEdge((edge, attrs) => {
    const isCircular = (attrs.isCircular as boolean) ?? false;
    graph.setEdgeAttribute(
      edge,
      'color',
      isCircular ? 'rgba(239, 68, 68, 0.7)' : 'rgba(150, 150, 150, 0.15)',
    );
    graph.setEdgeAttribute(edge, 'size', isCircular ? 2 : 0.5);
  });
}

function applyNodeDimming(
  graph: ReturnType<ReturnType<typeof useSigma>['getGraph']>,
  nodeMatchesFilters: (node: string) => boolean,
  originalColors: Map<string, { color: string; size: number }>,
): Set<string> {
  const matchingNodes = new Set<string>();
  graph.forEachNode((node) => {
    const matches = nodeMatchesFilters(node);
    if (matches) {
      matchingNodes.add(node);
      const orig = originalColors.get(node);
      if (orig) {
        graph.setNodeAttribute(node, 'color', orig.color);
        graph.setNodeAttribute(node, 'size', orig.size * 1.2);
      }
    } else {
      graph.setNodeAttribute(node, 'color', 'rgba(100, 100, 100, 0.2)');
      const orig = originalColors.get(node);
      if (orig) {
        graph.setNodeAttribute(node, 'size', orig.size * 0.6);
      }
    }
  });
  return matchingNodes;
}

function applyEdgeDimming(
  graph: ReturnType<ReturnType<typeof useSigma>['getGraph']>,
  matchingNodes: Set<string>,
): void {
  graph.forEachEdge((edge, _attrs, source, target) => {
    if (matchingNodes.has(source) && matchingNodes.has(target)) {
      graph.setEdgeAttribute(edge, 'color', 'rgba(150, 150, 150, 0.3)');
      graph.setEdgeAttribute(edge, 'size', 0.8);
    } else {
      graph.setEdgeAttribute(edge, 'color', 'rgba(100, 100, 100, 0.03)');
      graph.setEdgeAttribute(edge, 'size', 0.2);
    }
  });
}

function zoomToMatchingNodes(
  sigma: ReturnType<typeof useSigma>,
  graph: ReturnType<ReturnType<typeof useSigma>['getGraph']>,
  matchingNodes: Set<string>,
): void {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const n of matchingNodes) {
    const attrs = graph.getNodeAttributes(n);
    sumX += (attrs.x as number) ?? 0;
    sumY += (attrs.y as number) ?? 0;
    count++;
  }
  if (count > 0) {
    const camera = sigma.getCamera();
    const viewportCoords = sigma.graphToViewport({
      x: sumX / count,
      y: sumY / count,
    });
    const framedCoords = sigma.viewportToFramedGraph(viewportCoords);
    camera.animate(
      {
        x: framedCoords.x,
        y: framedCoords.y,
        ratio: matchingNodes.size === 1 ? 0.1 : 0.3,
      },
      { duration: 300 },
    );
  }
}
