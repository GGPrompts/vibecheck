'use client';

import { Scan, Bot } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { ComparisonScan, ComparisonAudit } from './types';
import { formatDate } from './helpers';

export function SourceInfoCards({
  scan,
  audit,
}: {
  scan: ComparisonScan | null;
  audit: ComparisonAudit | null;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Scan className="h-4 w-4" />
            Static Scan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scan ? (
            <div className="space-y-1 text-sm">
              <p>
                Score:{' '}
                <span className="font-bold">
                  {scan.overallScore ?? '--'}
                </span>
              </p>
              <p className="text-muted-foreground">
                {formatDate(scan.createdAt)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No completed scan available
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="h-4 w-4" />
            AI Audit
          </CardTitle>
        </CardHeader>
        <CardContent>
          {audit ? (
            <div className="space-y-1 text-sm">
              <p>
                Provider:{' '}
                <span className="font-medium">{audit.provider}</span>
                {audit.model && (
                  <span className="text-muted-foreground">
                    {' '}
                    ({audit.model})
                  </span>
                )}
              </p>
              <p className="text-muted-foreground">
                {formatDate(audit.createdAt)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No completed audit available
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
