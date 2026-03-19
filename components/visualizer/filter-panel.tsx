'use client';

import * as React from 'react';
import { useSigma } from '@react-sigma/core';
import { Filter, ChevronLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FileHealthMap } from '@/lib/visualizer/file-health';
import type { ArchLayer, ArchitectureAnalysis } from '@/lib/visualizer/architecture';

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
// Constants
// ---------------------------------------------------------------------------

const HEALTH_OPTIONS: Array<{ key: 'red' | 'yellow' | 'green'; label: string; color: string }> = [
  { key: 'red', label: 'Unhealthy', color: 'bg-red-500' },
  { key: 'yellow', label: 'Warning', color: 'bg-yellow-500' },
  { key: 'green', label: 'Healthy', color: 'bg-green-500' },
];

const LAYER_OPTIONS: ArchLayer[] = ['UI', 'API', 'Business', 'Data', 'Utils', 'Infra'];

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
  // (e.g. when the time slider scrubs to a different scan)
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

      // All filters empty = everything matches
      const hasHealthFilter = healthColors.size > 0;
      const hasLayerFilter = layers.size > 0;
      const hasSearchFilter = searchQuery.trim().length > 0;

      if (!hasHealthFilter && !hasLayerFilter && !hasSearchFilter) return true;

      // Health color filter
      if (hasHealthFilter) {
        const fileHealth = healthMap[node];
        if (fileHealth) {
          if (!healthColors.has(fileHealth.color)) return false;
        } else {
          // Files without health data don't match health filters
          return false;
        }
      }

      // Layer filter
      if (hasLayerFilter) {
        const layer = architecture?.layers?.[node];
        if (layer) {
          if (!layers.has(layer)) return false;
        } else {
          return false;
        }
      }

      // Search query
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
      // Restore original colors when no filters active
      graph.forEachNode((node) => {
        const orig = originalColorsRef.current.get(node);
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
      return;
    }

    // Apply dimming
    const matchingNodes = new Set<string>();
    graph.forEachNode((node) => {
      const matches = nodeMatchesFilters(node);
      if (matches) {
        matchingNodes.add(node);
        const orig = originalColorsRef.current.get(node);
        if (orig) {
          graph.setNodeAttribute(node, 'color', orig.color);
          graph.setNodeAttribute(node, 'size', orig.size * 1.2);
        }
      } else {
        graph.setNodeAttribute(node, 'color', 'rgba(100, 100, 100, 0.2)');
        const orig = originalColorsRef.current.get(node);
        if (orig) {
          graph.setNodeAttribute(node, 'size', orig.size * 0.6);
        }
      }
    });

    // Dim edges connected to non-matching nodes
    graph.forEachEdge((edge, _attrs, source, target) => {
      if (matchingNodes.has(source) && matchingNodes.has(target)) {
        graph.setEdgeAttribute(edge, 'color', 'rgba(150, 150, 150, 0.3)');
        graph.setEdgeAttribute(edge, 'size', 0.8);
      } else {
        graph.setEdgeAttribute(edge, 'color', 'rgba(100, 100, 100, 0.03)');
        graph.setEdgeAttribute(edge, 'size', 0.2);
      }
    });

    // If searching, zoom camera to matching nodes
    if (searchQuery.trim().length > 0 && matchingNodes.size > 0 && matchingNodes.size <= 50) {
      // Find centroid of matching nodes in graph coordinates
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
        // Convert graph coordinates to framed graph coordinates for camera
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
  }, [filters, sigma, nodeMatchesFilters]);

  // Handlers
  const toggleHealthColor = (color: 'red' | 'yellow' | 'green') => {
    const next = new Set(filters.healthColors);
    if (next.has(color)) {
      next.delete(color);
    } else {
      next.add(color);
    }
    onFiltersChange({ ...filters, healthColors: next });
  };

  const toggleLayer = (layer: ArchLayer) => {
    const next = new Set(filters.layers);
    if (next.has(layer)) {
      next.delete(layer);
    } else {
      next.add(layer);
    }
    onFiltersChange({ ...filters, layers: next });
  };

  const setSearchQuery = (query: string) => {
    onFiltersChange({ ...filters, searchQuery: query });
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
            {/* Search */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                Search
              </p>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                <Input
                  className="h-7 pl-7 text-xs"
                  placeholder="File name..."
                  value={filters.searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearchQuery(e.target.value)
                  }
                />
              </div>
            </div>

            {/* Health filter */}
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                Health
              </p>
              <div className="space-y-1">
                {HEALTH_OPTIONS.map(({ key, label, color }) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 -mx-1"
                  >
                    <input
                      type="checkbox"
                      checked={filters.healthColors.has(key)}
                      onChange={() => toggleHealthColor(key)}
                      className="size-3 rounded border-border accent-amber-500"
                    />
                    <span className={`size-2 rounded-full ${color}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Layer filter */}
            {architecture?.layers && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                  Layer
                </p>
                <div className="space-y-1">
                  {LAYER_OPTIONS.map((layer) => (
                    <label
                      key={layer}
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5 -mx-1"
                    >
                      <input
                        type="checkbox"
                        checked={filters.layers.has(layer)}
                        onChange={() => toggleLayer(layer)}
                        className="size-3 rounded border-border accent-amber-500"
                      />
                      <span className="text-xs text-muted-foreground">{layer}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
