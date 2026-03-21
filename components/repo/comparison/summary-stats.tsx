'use client';

import { CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

export function SummaryStats({
  summary,
}: {
  summary: {
    bothFlaggedCount: number;
    scanOnlyCount: number;
    auditOnlyCount: number;
  };
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardDescription>Both Flagged</CardDescription>
          <CardTitle className="text-2xl text-green-600 flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            {summary.bothFlaggedCount}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            High confidence -- scan and audit agree
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Scan Only</CardDescription>
          <CardTitle className="text-2xl text-yellow-600 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            {summary.scanOnlyCount}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            May be false positives
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Audit Only</CardDescription>
          <CardTitle className="text-2xl text-blue-600 flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            {summary.auditOnlyCount}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            AI caught what static analysis missed
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}
