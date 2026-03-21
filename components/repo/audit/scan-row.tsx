'use client';

import {
  ChevronDown,
  ChevronRight,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { AuditEntry } from './types';
import {
  formatDate,
  formatDuration,
  deltaColor,
  deltaPrefix,
  statusBadgeVariant,
} from './utils';
import { ScanDetails } from './scan-details';

interface ScanRowProps {
  entry: AuditEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ScanRow({ entry, isExpanded, onToggle }: ScanRowProps) {
  const DeltaIcon =
    entry.delta !== null && entry.delta > 0
      ? TrendingUp
      : entry.delta !== null && entry.delta < 0
        ? TrendingDown
        : Minus;

  return (
    <div>
      <button
        className="w-full text-left px-6 py-4 hover:bg-muted/50 transition-colors flex items-center gap-4"
        onClick={onToggle}
      >
        {/* Expand icon */}
        <div className="text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>

        {/* Timestamp */}
        <div className="min-w-[180px]">
          <p className="text-sm font-medium">
            {formatDate(entry.scan.createdAt)}
          </p>
        </div>

        {/* Status */}
        <Badge variant={statusBadgeVariant(entry.scan.status)}>
          {entry.scan.status}
        </Badge>

        {/* Score */}
        <div className="min-w-[60px] text-center">
          {entry.scan.overallScore !== null ? (
            <span className="text-lg font-bold">
              {entry.scan.overallScore}
            </span>
          ) : (
            <span className="text-muted-foreground">--</span>
          )}
        </div>

        {/* Delta */}
        <div
          className={`min-w-[70px] flex items-center gap-1 ${deltaColor(entry.delta)}`}
        >
          {entry.delta !== null ? (
            <>
              <DeltaIcon className="h-4 w-4" />
              <span className="text-sm font-medium">
                {deltaPrefix(entry.delta)}
                {entry.delta}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground text-sm">
              --
            </span>
          )}
        </div>

        {/* Duration */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground ml-auto">
          <Clock className="h-3.5 w-3.5" />
          {formatDuration(entry.scan.durationMs)}
        </div>
      </button>

      {isExpanded && <ScanDetails entry={entry} />}
    </div>
  );
}
