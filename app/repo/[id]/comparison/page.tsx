'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { ComparisonData } from '@/components/repo/comparison/types';
import { SourceInfoCards } from '@/components/repo/comparison/source-info-cards';
import { SummaryStats } from '@/components/repo/comparison/summary-stats';
import { ModuleComparisonCard } from '@/components/repo/comparison/module-comparison-card';
import {
  BothFlaggedCard,
  ScanOnlyCard,
  AuditOnlyCard,
} from '@/components/repo/comparison/finding-diff-cards';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchComparison() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/repos/${id}/comparison`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || 'Failed to load comparison data');
        }
        const result: ComparisonData = await res.json();
        setData(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load comparison',
        );
      } finally {
        setLoading(false);
      }
    }

    fetchComparison();
  }, [id]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/repo/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to repository
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            Scan vs Audit
          </h1>
          <p className="text-muted-foreground">Loading comparison data...</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 rounded-xl bg-muted/50 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/repo/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to repository
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            Scan vs Audit
          </h1>
        </div>
        <Card>
          <CardContent>
            <p className="text-destructive py-4">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { scan, audit, moduleComparisons, findingDiff, summary } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/repo/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to repository
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Scan vs Audit</h1>
        <p className="text-muted-foreground">
          Comparing static scan findings with independent AI audit results
        </p>
      </div>

      <SourceInfoCards scan={scan} audit={audit} />
      <SummaryStats summary={summary} />
      <ModuleComparisonCard moduleComparisons={moduleComparisons} />
      <BothFlaggedCard items={findingDiff.bothFlagged} />
      <ScanOnlyCard items={findingDiff.scanOnly} />
      <AuditOnlyCard items={findingDiff.auditOnly} />

      {/* Empty state when neither scan nor audit exists */}
      {!scan && !audit && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Run both a scan and an audit to see how their findings compare.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
