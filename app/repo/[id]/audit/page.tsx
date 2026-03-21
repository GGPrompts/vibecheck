'use client';

import { useEffect, useState, useMemo, useCallback, use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useAudit } from '@/components/audit-context';
import type { Scan, ScanDetail } from '@/components/repo/audit/types';
import {
  fetchScansForRepo,
  fetchScanDetails,
  buildAuditEntries,
  exportReport,
} from '@/components/repo/audit/utils';
import { AuditHeader } from '@/components/repo/audit/audit-header';
import { AuditLiveStream } from '@/components/repo/audit/audit-live-stream';
import { ScanTimeline } from '@/components/repo/audit/scan-timeline';

// ---------------------------------------------------------------------------
// Page shell for loading / error states
// ---------------------------------------------------------------------------

function PageShell({
  repoId,
  children,
}: {
  repoId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/repo/${repoId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to repository
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { activeAuditId, startAudit, stopAudit: ctxStopAudit } = useAudit();

  const [scans, setScans] = useState<Scan[]>([]);
  const [scanDetails, setScanDetails] = useState<Map<string, ScanDetail>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);
  const [auditStarting, setAuditStarting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const repoScans = await fetchScansForRepo(id);
      setScans(repoScans);
      const details = await fetchScanDetails(repoScans);
      setScanDetails(details);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load audit data'
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleRunAudit() {
    setAuditStarting(true);
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: id, provider: 'claude-cli' }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start audit');
      }
      const data = await res.json();
      startAudit(data.auditId);
    } catch (err) {
      console.error('Failed to start audit:', err);
    } finally {
      setAuditStarting(false);
    }
  }

  async function handleStopAudit() {
    if (!activeAuditId) return;
    try {
      await fetch(`/api/audits/${activeAuditId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    } catch (err) {
      console.error('Failed to stop audit:', err);
    }
    ctxStopAudit();
  }

  const handleAuditComplete = useCallback(() => {
    ctxStopAudit();
    fetchData();
  }, [ctxStopAudit, fetchData]);

  async function handleExport(format: 'markdown' | 'html') {
    setExportingFormat(format);
    try {
      await exportReport(id, format);
    } catch (err) {
      console.error('Report export failed:', err);
    } finally {
      setExportingFormat(null);
    }
  }

  const auditEntries = useMemo(
    () => buildAuditEntries(scans, scanDetails),
    [scans, scanDetails]
  );

  if (loading) {
    return (
      <PageShell repoId={id}>
        <p className="text-muted-foreground">Loading scan history...</p>
        <div className="space-y-4 mt-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell repoId={id}>
        <Card className="mt-4">
          <CardContent>
            <p className="text-destructive py-4">{error}</p>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  return (
    <div className="space-y-6">
      <AuditHeader
        repoId={id}
        activeAuditId={activeAuditId}
        auditStarting={auditStarting}
        exportingFormat={exportingFormat}
        onRunAudit={handleRunAudit}
        onStopAudit={handleStopAudit}
        onExport={handleExport}
      />

      {activeAuditId && (
        <AuditLiveStream onStop={handleStopAudit} onComplete={handleAuditComplete} />
      )}

      {scans.length === 0 && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Clock className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No scans yet</h3>
              <p className="text-muted-foreground max-w-md">
                Run a scan from the repository page to start building your audit trail.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <ScanTimeline entries={auditEntries} totalScans={scans.length} />
    </div>
  );
}
