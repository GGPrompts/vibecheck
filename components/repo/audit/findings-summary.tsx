'use client';

import { Badge } from '@/components/ui/badge';
import type { ModuleResult } from './types';
import { severitySort, isHighSeverity } from './utils';

interface FindingsSummaryProps {
  modules: ModuleResult[];
}

export function FindingsSummary({ modules }: FindingsSummaryProps) {
  const modulesWithFindings = modules.filter((m) => m.findings.length > 0);
  if (modulesWithFindings.length === 0) return null;

  // Aggregate severity counts
  const counts: Record<string, number> = {};
  modules.forEach((m) => {
    m.findings.forEach((f) => {
      const sev = f.severity.toLowerCase();
      counts[sev] = (counts[sev] || 0) + 1;
    });
  });

  const sortedCounts = Object.entries(counts).sort((a, b) =>
    severitySort(a[0], b[0])
  );

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Findings Summary
      </p>
      <div className="flex gap-2 flex-wrap mb-3">
        {sortedCounts.map(([sev, count]) => (
          <Badge
            key={sev}
            variant={isHighSeverity(sev) ? 'destructive' : 'secondary'}
          >
            {count} {sev}
          </Badge>
        ))}
      </div>

      <div className="space-y-3">
        {modulesWithFindings.map((mod) => (
          <div key={mod.moduleId}>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">
              {mod.moduleId}{' '}
              <span className="text-muted-foreground/60">
                ({mod.findings.length} finding
                {mod.findings.length !== 1 ? 's' : ''})
              </span>
            </p>
            <div className="space-y-1">
              {mod.findings.slice(0, 10).map((f) => (
                <div
                  key={f.id}
                  className="flex items-start gap-2 text-xs px-2.5 py-1.5 bg-background rounded border border-border/50"
                >
                  <Badge
                    variant={
                      isHighSeverity(f.severity)
                        ? 'destructive'
                        : 'secondary'
                    }
                    className="text-[10px] px-1.5 py-0 shrink-0 mt-0.5"
                  >
                    {f.severity}
                  </Badge>
                  <span className="text-foreground/90 break-all">
                    {f.filePath && (
                      <span className="text-muted-foreground font-mono">
                        {f.filePath}
                        {f.line ? `:${f.line}` : ''}
                        {' — '}
                      </span>
                    )}
                    {f.message}
                  </span>
                </div>
              ))}
              {mod.findings.length > 10 && (
                <p className="text-xs text-muted-foreground pl-2.5">
                  ... and {mod.findings.length - 10} more
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
