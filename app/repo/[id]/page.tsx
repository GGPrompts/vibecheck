'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScanProgress } from '@/components/scan-progress';
import { AuditProgress } from '@/components/audit-progress';
import { FindingsTable } from '@/components/findings-table';
import { PromptOutput } from '@/components/prompt-output';
import {
  RepoHeader,
  AdoptionAssessment,
  ModuleGrid,
  ChartsSection,
  AuditSection,
  RepoLoadingSkeleton,
  EmptyState,
  computeClientEvaluation,
  buildHotspotData,
  getBlockingFindings,
} from '@/components/repo';
import type {
  RepoData,
  ScanDetail,
  AuditDetail,
  AuditProvider,
  ScanFinding,
} from '@/components/repo';

export default function RepoPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [repo, setRepo] = React.useState<RepoData | null>(null);
  const [scanDetail, setScanDetail] = React.useState<ScanDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [scanLoading, setScanLoading] = React.useState(false);
  const [activeScanId, setActiveScanId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [auditLoading, setAuditLoading] = React.useState(false);
  const [activeAuditId, setActiveAuditId] = React.useState<string | null>(null);
  const [auditDetail, setAuditDetail] = React.useState<AuditDetail | null>(null);
  const [auditProviderCount, setAuditProviderCount] = React.useState(0);

  const isEvaluation = repo?.mode === 'evaluating';

  const fetchData = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const reposRes = await fetch('/api/repos');
      if (!reposRes.ok) throw new Error('Failed to fetch repos');
      const allRepos: RepoData[] = await reposRes.json();
      const currentRepo = allRepos.find((r) => r.id === id);
      if (!currentRepo) {
        setError('Repository not found');
        return;
      }
      setRepo(currentRepo);

      if (currentRepo.latestScan) {
        const scanRes = await fetch(`/api/scans/${currentRepo.latestScan.id}`);
        if (scanRes.ok) {
          const data: ScanDetail = await scanRes.json();
          const enrichedModules = data.modules.map((mod) => ({
            ...mod,
            findings: mod.findings.map((f) => ({ ...f, moduleId: mod.moduleId })),
          }));
          setScanDetail({ ...data, modules: enrichedModules });
        }
      }

      try {
        const auditsRes = await fetch('/api/audits');
        if (auditsRes.ok) {
          const allAudits = await auditsRes.json();
          const repoAudits = allAudits.filter(
            (a: { repoId: string }) => a.repoId === currentRepo.id
          );
          const completedProviders = new Set(
            repoAudits
              .filter((a: { status: string }) => a.status === 'completed')
              .map((a: { provider: string }) => a.provider)
          );
          setAuditProviderCount(completedProviders.size);
          const latestAudit = repoAudits[0];
          if (latestAudit) {
            const auditRes = await fetch(`/api/audits/${latestAudit.id}`);
            if (auditRes.ok) {
              setAuditDetail(await auditRes.json());
            }
          }
        }
      } catch {
        // Non-critical -- audit data is supplementary
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const handleScanNow = async () => {
    try {
      setScanLoading(true);
      setError(null);
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to start scan');
        return;
      }
      setActiveScanId(data.scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setScanLoading(false);
    }
  };

  const handleStartAudit = (provider: AuditProvider) => {
    setAuditLoading(true);
    setError(null);
    fetch('/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId: id, provider }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setActiveAuditId(data.auditId);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Network error'))
      .finally(() => setAuditLoading(false));
  };

  const handleScanComplete = () => { setActiveScanId(null); fetchData(); };
  const handleAuditComplete = () => { setActiveAuditId(null); fetchData(); };

  if (loading) return <RepoLoadingSkeleton />;

  if (error && !repo) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Repository</h1>
        <Card><CardContent><p className="text-destructive">{error}</p></CardContent></Card>
      </div>
    );
  }

  if (!repo) return null;

  const allFindings: ScanFinding[] = scanDetail?.modules.flatMap((m) => m.findings) ?? [];
  const scoringSummary = scanDetail?.scan.scoringSummary;
  const modulesPassing = scoringSummary?.passing
    ?? scanDetail?.modules.filter((m) => m.state === 'completed' && m.score > 60).length
    ?? 0;
  const totalModules = scoringSummary?.scored
    ?? scanDetail?.modules.filter((m) => m.state === 'completed').length
    ?? 0;
  const evaluationResult = isEvaluation && scanDetail ? computeClientEvaluation(scanDetail.modules) : null;
  const hotspotData = scanDetail ? buildHotspotData(scanDetail) : [];
  const blockingFindings = isEvaluation ? getBlockingFindings(allFindings) : [];
  const displayScore = isEvaluation
    ? evaluationResult?.adoptionRisk ?? null
    : scanDetail?.scan.overallScore ?? repo.latestScan?.overallScore ?? null;

  return (
    <div className="space-y-8">
      <RepoHeader
        repo={repo}
        scanDetail={scanDetail}
        auditDetail={auditDetail}
        evaluationResult={evaluationResult}
        isEvaluation={isEvaluation}
        displayScore={displayScore}
        allFindings={allFindings}
        modulesPassing={modulesPassing}
        totalModules={totalModules}
        error={error}
        scanLoading={scanLoading}
        auditLoading={auditLoading}
        activeScanId={activeScanId}
        activeAuditId={activeAuditId}
        onScanNow={handleScanNow}
        onStartAudit={handleStartAudit}
      />

      {isEvaluation && evaluationResult && (
        <AdoptionAssessment evaluationResult={evaluationResult} blockingFindings={blockingFindings} />
      )}

      {activeScanId && (
        <Card>
          <CardHeader>
            <CardTitle>{isEvaluation ? 'Evaluation in Progress' : 'Scan in Progress'}</CardTitle>
          </CardHeader>
          <CardContent>
            <ScanProgress scanId={activeScanId} onComplete={handleScanComplete} />
          </CardContent>
        </Card>
      )}

      {activeAuditId && (
        <Card>
          <CardHeader><CardTitle>AI Audit in Progress</CardTitle></CardHeader>
          <CardContent>
            <AuditProgress auditId={activeAuditId} onComplete={handleAuditComplete} />
          </CardContent>
        </Card>
      )}

      {scanDetail && scanDetail.modules.length > 0 && (
        <ModuleGrid
          repoId={id}
          modules={scanDetail.modules}
          scoringSummary={scanDetail.scan.scoringSummary}
        />
      )}

      {scanDetail && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Handoff</CardTitle>
          </CardHeader>
          <CardContent>
            <PromptOutput scanId={scanDetail.scan.id} defaultView="actions" />
          </CardContent>
        </Card>
      )}

      {scanDetail && scanDetail.modules.length > 0 && (
        <ChartsSection modules={scanDetail.modules} hotspotData={hotspotData} />
      )}

      {scanDetail && allFindings.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">All Findings</h2>
          <FindingsTable findings={allFindings} />
        </section>
      )}

      {auditDetail && (
        <AuditSection repoId={id} auditDetail={auditDetail} auditProviderCount={auditProviderCount} />
      )}

      {!scanDetail && !activeScanId && (
        <EmptyState isEvaluation={isEvaluation} scanLoading={scanLoading} onScanNow={handleScanNow} />
      )}
    </div>
  );
}
