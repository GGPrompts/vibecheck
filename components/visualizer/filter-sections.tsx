'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ArchLayer, ArchitectureAnalysis } from '@/lib/visualizer/architecture';
import type { FilterState } from './filter-panel';

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
// Search section
// ---------------------------------------------------------------------------

export function SearchFilter({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
        Search
      </p>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
        <Input
          className="h-7 pl-7 text-xs"
          placeholder="File name..."
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onSearchChange(e.target.value)
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health color filter section
// ---------------------------------------------------------------------------

export function HealthFilter({
  healthColors,
  onToggle,
}: {
  healthColors: Set<'red' | 'yellow' | 'green'>;
  onToggle: (color: 'red' | 'yellow' | 'green') => void;
}) {
  return (
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
              checked={healthColors.has(key)}
              onChange={() => onToggle(key)}
              className="size-3 rounded border-border accent-amber-500"
            />
            <span className={`size-2 rounded-full ${color}`} />
            <span className="text-xs text-muted-foreground">{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layer filter section
// ---------------------------------------------------------------------------

export function LayerFilter({
  architecture,
  layers,
  onToggle,
}: {
  architecture: ArchitectureAnalysis | null;
  layers: Set<ArchLayer>;
  onToggle: (layer: ArchLayer) => void;
}) {
  if (!architecture?.layers) return null;

  return (
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
              checked={layers.has(layer)}
              onChange={() => onToggle(layer)}
              className="size-3 rounded border-border accent-amber-500"
            />
            <span className="text-xs text-muted-foreground">{layer}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
