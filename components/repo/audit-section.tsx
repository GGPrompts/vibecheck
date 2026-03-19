'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitCompareArrows } from 'lucide-react';
import { formatDuration } from './evaluation-utils';
import type { AuditDetail, AuditProvider } from './types';
import { PROVIDER_LABELS } from './types';

interface AuditSectionProps {
  repoId: string;
  auditDetail: AuditDetail;
  auditProviderCount: number;
}

export function AuditSection({ repoId, auditDetail, auditProviderCount }: AuditSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">AI Audit</h2>
          {auditProviderCount >= 2 && (
            <Link href={`/repo/${repoId}/compare-audits`}>
              <Button variant="outline" size="sm">
                <GitCompareArrows className="size-4" data-icon="inline-start" />
                Compare Audits
              </Button>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">
            {PROVIDER_LABELS[auditDetail.audit.provider as AuditProvider] ??
              auditDetail.audit.provider}
          </Badge>
          <Badge
            variant={
              auditDetail.audit.status === 'completed'
                ? 'default'
                : auditDetail.audit.status === 'failed'
                  ? 'destructive'
                  : 'secondary'
            }
          >
            {auditDetail.audit.status}
          </Badge>
          {auditDetail.audit.durationMs && (
            <span>{formatDuration(auditDetail.audit.durationMs)}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {auditDetail.modules.map((mod) => {
          const findingCount = mod.findings.length;
          const severityCounts: Record<string, number> = {};
          for (const f of mod.findings) {
            severityCounts[f.severity] =
              (severityCounts[f.severity] ?? 0) + 1;
          }

          return (
            <Card key={mod.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base capitalize">
                  {mod.moduleId.replace(/-/g, ' ')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {mod.summary && (
                  <p className="text-sm text-muted-foreground">
                    {mod.summary}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {findingCount} finding
                    {findingCount !== 1 ? 's' : ''}
                  </Badge>
                  {severityCounts.critical && (
                    <Badge variant="destructive">
                      {severityCounts.critical} critical
                    </Badge>
                  )}
                  {severityCounts.high && (
                    <Badge
                      variant="destructive"
                      className="bg-orange-600"
                    >
                      {severityCounts.high} high
                    </Badge>
                  )}
                  {severityCounts.medium && (
                    <Badge variant="secondary">
                      {severityCounts.medium} medium
                    </Badge>
                  )}
                </div>

                {mod.findings.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {mod.findings.slice(0, 5).map((f, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span
                          className={`mt-1 inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                            f.severity === 'critical'
                              ? 'bg-red-500'
                              : f.severity === 'high'
                                ? 'bg-orange-500'
                                : f.severity === 'medium'
                                  ? 'bg-yellow-500'
                                  : 'bg-blue-400'
                          }`}
                        />
                        <span className="text-muted-foreground">
                          {f.file && (
                            <span className="font-mono text-foreground">
                              {f.file}
                              {f.line ? `:${f.line}` : ''}
                            </span>
                          )}{' '}
                          {f.message}
                        </span>
                      </li>
                    ))}
                    {mod.findings.length > 5 && (
                      <li className="text-muted-foreground">
                        ...and {mod.findings.length - 5} more
                      </li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
