export function formatDuration(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function deltaColor(delta: number | null): string {
  if (delta === null || delta === 0) return 'text-muted-foreground';
  return delta > 0 ? 'text-green-500' : 'text-red-500';
}

export function deltaPrefix(delta: number | null): string {
  if (delta === null) return '';
  if (delta > 0) return '+';
  return '';
}

export function statusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'running':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export function severitySort(a: string, b: string): number {
  return SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);
}

export function isHighSeverity(severity: string): boolean {
  return severity === 'critical' || severity === 'high';
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

import type { Scan, ScanDetail, AuditEntry } from './types';

export async function fetchScansForRepo(repoId: string): Promise<Scan[]> {
  const res = await fetch('/api/scans');
  if (!res.ok) throw new Error('Failed to fetch scans');

  const allScans: Scan[] = await res.json();
  return allScans
    .filter((s) => s.repoId === repoId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

export async function fetchScanDetails(
  scans: Scan[]
): Promise<Map<string, ScanDetail>> {
  const detailsMap = new Map<string, ScanDetail>();
  const detailPromises = scans
    .filter((s) => s.status === 'completed')
    .map(async (scan) => {
      try {
        const res = await fetch(`/api/scans/${scan.id}`);
        if (res.ok) {
          const detail: ScanDetail = await res.json();
          detailsMap.set(scan.id, detail);
        }
      } catch {
        // Skip failed detail fetches
      }
    });

  await Promise.all(detailPromises);
  return detailsMap;
}

// ---------------------------------------------------------------------------
// Build audit entries with deltas
// ---------------------------------------------------------------------------

export function buildAuditEntries(
  scans: Scan[],
  scanDetails: Map<string, ScanDetail>
): AuditEntry[] {
  return scans.map((scan, index) => {
    const detail = scanDetails.get(scan.id) ?? null;
    const prevScan = scans[index + 1];
    const prevDetail = prevScan ? scanDetails.get(prevScan.id) : null;

    let delta: number | null = null;
    if (
      scan.overallScore !== null &&
      prevScan?.overallScore !== null &&
      prevScan?.overallScore !== undefined
    ) {
      delta = scan.overallScore - prevScan.overallScore;
    }

    const moduleDiffs: AuditEntry['moduleDiffs'] = [];
    if (detail && prevDetail) {
      for (const mod of detail.modules) {
        const prevMod = prevDetail.modules.find(
          (m) => m.moduleId === mod.moduleId
        );
        if (prevMod && mod.score !== prevMod.score) {
          moduleDiffs.push({
            moduleId: mod.moduleId,
            current: mod.score,
            previous: prevMod.score,
            diff: mod.score - prevMod.score,
          });
        }
      }
    }

    return { scan, detail, delta, moduleDiffs };
  });
}

// ---------------------------------------------------------------------------
// Report export
// ---------------------------------------------------------------------------

export async function exportReport(
  repoId: string,
  format: 'markdown' | 'html'
): Promise<void> {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, format }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to generate report');
  }

  const data = await res.json();
  const ext = format === 'markdown' ? 'md' : 'html';
  const mimeType = format === 'markdown' ? 'text/markdown' : 'text/html';
  const blob = new Blob([data.report], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.download = `vibecheck-report-${new Date().toISOString().slice(0, 10)}.${ext}`;
  link.href = url;
  link.click();

  URL.revokeObjectURL(url);
}
