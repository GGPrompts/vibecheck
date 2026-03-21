'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import type { AuditEntry } from './types';
import { ScanRow } from './scan-row';

interface ScanTimelineProps {
  entries: AuditEntry[];
  totalScans: number;
}

export function ScanTimeline({ entries, totalScans }: ScanTimelineProps) {
  const [expandedScan, setExpandedScan] = useState<string | null>(null);

  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan Timeline</CardTitle>
        <CardDescription>
          {totalScans} scan{totalScans !== 1 ? 's' : ''} recorded
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {entries.map((entry) => (
            <ScanRow
              key={entry.scan.id}
              entry={entry}
              isExpanded={expandedScan === entry.scan.id}
              onToggle={() =>
                setExpandedScan(
                  expandedScan === entry.scan.id ? null : entry.scan.id
                )
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
