'use client';

import * as React from 'react';
import { useSigma } from '@react-sigma/core';
import { Play, Pause, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { healthToColor, DEFAULT_NODE_COLOR } from './graph-renderer';
import type { FileHealthMap } from '@/lib/visualizer/file-health';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanSummary {
  id: string;
  repoId: string | null;
  repoName: string | null;
  status: string;
  overallScore: number | null;
  durationMs: number | null;
  createdAt: string;
}

interface TimeSliderProps {
  repoId: string;
  currentHealthMap: FileHealthMap;
  onHealthMapChange: (healthMap: FileHealthMap, scanId: string | null, overallScore: number | null) => void;
}

// ---------------------------------------------------------------------------
// Speed options
// ---------------------------------------------------------------------------

const SPEED_OPTIONS = [
  { label: '1s', ms: 1000 },
  { label: '2s', ms: 2000 },
  { label: '5s', ms: 5000 },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TimeSlider({ repoId, currentHealthMap, onHealthMapChange }: TimeSliderProps) {
  const sigma = useSigma();

  // Scan list state
  const [scans, setScans] = React.useState<ScanSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [currentIndex, setCurrentIndex] = React.useState<number>(-1);

  // Playback state
  const [playing, setPlaying] = React.useState(false);
  const [speedIndex, setSpeedIndex] = React.useState(1); // default 2s

  // Health data cache: scanId -> FileHealthMap
  const healthCacheRef = React.useRef<Map<string, FileHealthMap>>(new Map());

  // Score overlay state
  const [scoreOverlay, setScoreOverlay] = React.useState<{
    score: number | null;
    delta: number | null;
  } | null>(null);

  // Track if this is an active time-travel session (not viewing latest)
  const isTimeTraveling = React.useRef(false);

  // ---------------------------------------------------------------------------
  // Fetch scan list on mount
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    let cancelled = false;

    async function fetchScans() {
      try {
        setLoading(true);
        const res = await fetch(`/api/scans?repoId=${encodeURIComponent(repoId)}&status=completed`);
        if (!res.ok) return;

        const data: ScanSummary[] = await res.json();
        if (cancelled) return;

        // Sort chronologically (oldest first) for slider
        const sorted = data
          .filter((s) => s.status === 'completed')
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        setScans(sorted);
        // Start at the latest scan (rightmost)
        setCurrentIndex(sorted.length - 1);
      } catch {
        // Silently fail — slider just won't appear
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchScans();
    return () => { cancelled = true; };
  }, [repoId]);

  // ---------------------------------------------------------------------------
  // Fetch health data for a scan (with cache)
  // ---------------------------------------------------------------------------

  const fetchHealthForScan = React.useCallback(
    async (scanId: string): Promise<FileHealthMap> => {
      const cached = healthCacheRef.current.get(scanId);
      if (cached) return cached;

      try {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(repoId)}/file-health?scanId=${encodeURIComponent(scanId)}`,
        );
        if (!res.ok) return {};

        const data: FileHealthMap = await res.json();
        healthCacheRef.current.set(scanId, data);
        return data;
      } catch {
        return {};
      }
    },
    [repoId],
  );

  // ---------------------------------------------------------------------------
  // Apply health map to graph nodes
  // ---------------------------------------------------------------------------

  const applyHealthToGraph = React.useCallback(
    (newHealthMap: FileHealthMap) => {
      const graph = sigma.getGraph();
      if (graph.order === 0) return;

      graph.forEachNode((node) => {
        const fileHealth = newHealthMap[node];
        const color = fileHealth
          ? healthToColor(fileHealth.health)
          : DEFAULT_NODE_COLOR;
        graph.setNodeAttribute(node, 'color', color);
      });
    },
    [sigma],
  );

  // ---------------------------------------------------------------------------
  // Handle slider change
  // ---------------------------------------------------------------------------

  const handleSliderChange = React.useCallback(
    async (index: number) => {
      if (index < 0 || index >= scans.length) return;

      const scan = scans[index];
      const isLatest = index === scans.length - 1;

      if (isLatest) {
        // Restore to current (latest) health map
        if (isTimeTraveling.current) {
          isTimeTraveling.current = false;
          applyHealthToGraph(currentHealthMap);
          onHealthMapChange(currentHealthMap, null, null);
          setScoreOverlay(null);
        }
        return;
      }

      isTimeTraveling.current = true;

      const newHealthMap = await fetchHealthForScan(scan.id);
      applyHealthToGraph(newHealthMap);
      onHealthMapChange(newHealthMap, scan.id, scan.overallScore);

      // Calculate score delta
      const prevScore =
        index > 0 ? scans[index - 1].overallScore : null;
      const delta =
        scan.overallScore != null && prevScore != null
          ? scan.overallScore - prevScore
          : null;

      setScoreOverlay({
        score: scan.overallScore,
        delta,
      });
    },
    [scans, currentHealthMap, fetchHealthForScan, applyHealthToGraph, onHealthMapChange],
  );

  // ---------------------------------------------------------------------------
  // Playback loop
  // ---------------------------------------------------------------------------

  React.useEffect(() => {
    if (!playing) return;

    const speed = SPEED_OPTIONS[speedIndex].ms;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next >= scans.length) {
          // Reached the end — stop playing
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, speed);

    return () => clearInterval(interval);
  }, [playing, speedIndex, scans.length]);

  // Trigger health fetch whenever currentIndex changes during playback
  React.useEffect(() => {
    if (currentIndex >= 0 && currentIndex < scans.length) {
      handleSliderChange(currentIndex);
    }
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Format date for labels
  // ---------------------------------------------------------------------------

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    const hour = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${month} ${day} ${hour}:${min}`;
  };

  const formatDateShort = (dateStr: string): string => {
    const date = new Date(dateStr);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day}`;
  };

  // ---------------------------------------------------------------------------
  // Don't render if loading, no scans, or only 1 scan
  // ---------------------------------------------------------------------------

  if (loading || scans.length <= 1) {
    return null;
  }

  const currentScan = scans[currentIndex] ?? scans[scans.length - 1];

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10">
      {/* Score overlay during time travel */}
      {scoreOverlay && scoreOverlay.score != null && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2 shadow-lg flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">
            Score: {scoreOverlay.score}
          </span>
          {scoreOverlay.delta != null && scoreOverlay.delta !== 0 && (
            <span
              className={`text-sm font-medium ${
                scoreOverlay.delta > 0
                  ? 'text-green-400'
                  : 'text-red-400'
              }`}
            >
              ({scoreOverlay.delta > 0 ? '+' : ''}
              {scoreOverlay.delta})
            </span>
          )}
        </div>
      )}

      {/* Slider bar */}
      <div className="bg-zinc-900/95 backdrop-blur-sm border-t border-zinc-700 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Play/pause button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-zinc-300 hover:text-white hover:bg-zinc-700"
            onClick={() => {
              if (playing) {
                setPlaying(false);
              } else {
                // If at end, restart from beginning
                if (currentIndex >= scans.length - 1) {
                  setCurrentIndex(0);
                }
                setPlaying(true);
              }
            }}
            title={playing ? 'Pause' : 'Play through scan history'}
          >
            {playing ? (
              <Pause className="size-4" />
            ) : (
              <Play className="size-4" />
            )}
          </Button>

          {/* Clock icon + current date */}
          <div className="flex items-center gap-1.5 shrink-0 min-w-[120px]">
            <Clock className="size-3.5 text-zinc-400" />
            <span className="text-xs text-zinc-300 font-medium">
              {formatDate(currentScan.createdAt)}
            </span>
          </div>

          {/* The range slider */}
          <div className="flex-1 flex flex-col gap-1">
            <input
              type="range"
              min={0}
              max={scans.length - 1}
              value={currentIndex}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                if (playing) setPlaying(false);
                setCurrentIndex(idx);
              }}
              className="w-full h-1.5 appearance-none bg-zinc-700 rounded-full cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3.5
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-zinc-900
                [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md
                [&::-webkit-slider-thumb]:hover:bg-indigo-300
                [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:bg-indigo-400 [&::-moz-range-thumb]:border-2
                [&::-moz-range-thumb]:border-zinc-900 [&::-moz-range-thumb]:cursor-pointer"
              title={`Scan ${currentIndex + 1} of ${scans.length}`}
            />

            {/* Tick labels — show first, last, and a few in between */}
            <div className="flex justify-between px-0.5">
              {scans.length <= 8 ? (
                // Show all labels if few scans
                scans.map((scan, i) => (
                  <button
                    key={scan.id}
                    className={`text-[9px] cursor-pointer hover:text-zinc-200 transition-colors ${
                      i === currentIndex
                        ? 'text-indigo-400 font-semibold'
                        : 'text-zinc-500'
                    }`}
                    onClick={() => {
                      if (playing) setPlaying(false);
                      setCurrentIndex(i);
                    }}
                  >
                    {formatDateShort(scan.createdAt)}
                  </button>
                ))
              ) : (
                // Show first, some middle, and last for many scans
                <>
                  <button
                    className={`text-[9px] cursor-pointer hover:text-zinc-200 transition-colors ${
                      currentIndex === 0 ? 'text-indigo-400 font-semibold' : 'text-zinc-500'
                    }`}
                    onClick={() => {
                      if (playing) setPlaying(false);
                      setCurrentIndex(0);
                    }}
                  >
                    {formatDateShort(scans[0].createdAt)}
                  </button>
                  <span className="text-[9px] text-zinc-600">
                    {scans.length} scans
                  </span>
                  <button
                    className={`text-[9px] cursor-pointer hover:text-zinc-200 transition-colors ${
                      currentIndex === scans.length - 1
                        ? 'text-indigo-400 font-semibold'
                        : 'text-zinc-500'
                    }`}
                    onClick={() => {
                      if (playing) setPlaying(false);
                      setCurrentIndex(scans.length - 1);
                    }}
                  >
                    {formatDateShort(scans[scans.length - 1].createdAt)}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Speed control */}
          <div className="flex items-center gap-1 shrink-0">
            {SPEED_OPTIONS.map((opt, i) => (
              <button
                key={opt.label}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  speedIndex === i
                    ? 'bg-indigo-500/30 text-indigo-300 font-semibold'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={() => setSpeedIndex(i)}
                title={`${opt.label} per scan step`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Scan counter */}
          <span className="text-[10px] text-zinc-500 shrink-0 tabular-nums">
            {currentIndex + 1}/{scans.length}
          </span>
        </div>
      </div>
    </div>
  );
}
