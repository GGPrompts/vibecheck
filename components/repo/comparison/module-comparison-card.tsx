'use client';

import { Scan, Bot } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ModuleComparison } from './types';
import { formatModuleName, ScoreBar } from './helpers';

export function ModuleComparisonCard({
  moduleComparisons,
}: {
  moduleComparisons: ModuleComparison[];
}) {
  if (moduleComparisons.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Per-Module Comparison</CardTitle>
        <CardDescription>
          Side-by-side view of scan scores and audit summaries per module
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-0 divide-y">
        {moduleComparisons.map((mod) => (
          <div key={mod.moduleId} className="py-4 first:pt-0 last:pb-0">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-sm font-semibold">
                {formatModuleName(mod.moduleId)}
              </h3>
              {mod.hasScan && mod.hasAudit && (
                <Badge
                  variant="outline"
                  className="text-green-600 border-green-500/50"
                >
                  Both covered
                </Badge>
              )}
              {mod.hasScan && !mod.hasAudit && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground border-muted-foreground/30"
                >
                  No audit data
                </Badge>
              )}
              {!mod.hasScan && mod.hasAudit && (
                <Badge
                  variant="outline"
                  className="text-muted-foreground border-muted-foreground/30"
                >
                  No scan data
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Scan side */}
              <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Scan className="h-3 w-3" />
                  Scan
                </p>
                {mod.hasScan ? (
                  <>
                    <ScoreBar
                      score={mod.scanScore}
                      label="Score"
                    />
                    {mod.scanSummary && (
                      <p className="text-xs text-muted-foreground">
                        {mod.scanSummary}
                      </p>
                    )}
                    <p className="text-xs">
                      {mod.scanFindingCount} finding
                      {mod.scanFindingCount !== 1 ? 's' : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Not covered by scan
                  </p>
                )}
              </div>

              {/* Audit side */}
              <div className="space-y-2 rounded-lg bg-muted/30 p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Bot className="h-3 w-3" />
                  Audit
                </p>
                {mod.hasAudit ? (
                  <>
                    {mod.auditSummary && (
                      <p className="text-xs text-muted-foreground">
                        {mod.auditSummary}
                      </p>
                    )}
                    <p className="text-xs">
                      {mod.auditFindingCount} finding
                      {mod.auditFindingCount !== 1 ? 's' : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Not covered by audit
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
