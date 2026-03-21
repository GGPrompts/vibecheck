'use client';

import type { AuditEntry } from './types';
import { deltaColor, deltaPrefix } from './utils';
import { FindingsSummary } from './findings-summary';

interface ScanDetailsProps {
  entry: AuditEntry;
}

export function ScanDetails({ entry }: ScanDetailsProps) {
  if (!entry.detail) {
    return (
      <div className="px-6 pb-4 pl-16">
        <p className="text-sm text-muted-foreground">
          {entry.scan.status === 'completed'
            ? 'Module details unavailable for this scan.'
            : `Scan status: ${entry.scan.status}`}
        </p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-4 pl-16 space-y-3">
      {/* Module scores */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Module Scores
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {entry.detail.modules.map((mod) => {
            const moduleDiff = entry.moduleDiffs.find(
              (d) => d.moduleId === mod.moduleId
            );
            return (
              <div
                key={mod.moduleId}
                className="flex items-center justify-between px-3 py-2 bg-muted/40 rounded-md"
              >
                <span className="text-sm font-medium">
                  {mod.moduleId}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">
                    {mod.score}
                  </span>
                  {moduleDiff && (
                    <span
                      className={`text-xs font-medium ${deltaColor(moduleDiff.diff)}`}
                    >
                      {deltaPrefix(moduleDiff.diff)}
                      {moduleDiff.diff}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Findings summary */}
      {entry.detail.modules.some((m) => m.findings.length > 0) && (
        <FindingsSummary modules={entry.detail.modules} />
      )}
    </div>
  );
}
