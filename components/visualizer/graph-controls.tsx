'use client';

import * as React from 'react';
import { useCamera } from '@react-sigma/core';
import { Button } from '@/components/ui/button';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface GraphControlsProps {
  nodeCount: number;
  edgeCount: number;
}

export function GraphControls({ nodeCount, edgeCount }: GraphControlsProps) {
  const { zoomIn, zoomOut, reset } = useCamera();

  return (
    <div className="absolute top-3 right-3 flex flex-col gap-3 z-10">
      {/* Camera controls */}
      <div className="flex flex-col gap-1 bg-background/80 backdrop-blur-sm rounded-lg border border-border p-1.5 shadow-md">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => zoomIn()}
          title="Zoom in"
        >
          <ZoomIn className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => zoomOut()}
          title="Zoom out"
        >
          <ZoomOut className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => reset()}
          title="Fit view"
        >
          <Maximize2 className="size-4" />
        </Button>
      </div>

      {/* Stats & Legend */}
      <div className="bg-background/80 backdrop-blur-sm rounded-lg border border-border p-3 shadow-md space-y-3 min-w-[140px]">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
            Stats
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{nodeCount}</span> nodes
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{edgeCount}</span> edges
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
            Health
          </p>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: '#22c55e' }}
            />
            <span className="text-xs text-muted-foreground">Healthy (70-100)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: '#eab308' }}
            />
            <span className="text-xs text-muted-foreground">Warning (40-70)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: '#ef4444' }}
            />
            <span className="text-xs text-muted-foreground">Unhealthy (0-40)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
