'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Play, ShieldAlert } from 'lucide-react';

interface EmptyStateProps {
  isEvaluation: boolean;
  scanLoading: boolean;
  onScanNow: () => void;
}

export function EmptyState({ isEvaluation, scanLoading, onScanNow }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-muted-foreground mb-4">
          {isEvaluation
            ? 'No evaluation results yet. Run your first evaluation to see adoption risk metrics.'
            : 'No scan results yet. Run your first scan to see health metrics.'}
        </p>
        <Button onClick={onScanNow} disabled={scanLoading}>
          {scanLoading ? (
            <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
          ) : isEvaluation ? (
            <ShieldAlert className="size-4" data-icon="inline-start" />
          ) : (
            <Play className="size-4" data-icon="inline-start" />
          )}
          {isEvaluation ? 'Run First Evaluation' : 'Run First Scan'}
        </Button>
      </CardContent>
    </Card>
  );
}
