'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditFinding {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
}

interface Agreement {
  key: string;
  findingsA: AuditFinding[];
  findingsB: AuditFinding[];
}

interface ProviderOnlyGroup {
  key: string;
  findings: AuditFinding[];
}

interface ModuleComparison {
  moduleId: string;
  summaryA: string | null;
  summaryB: string | null;
  agreementScore: number;
  agreements: Agreement[];
  providerAOnly: ProviderOnlyGroup[];
  providerBOnly: ProviderOnlyGroup[];
  findingCountA: number;
  findingCountB: number;
}

interface ProviderInfo {
  provider: string;
  auditId: string;
  model: string | null;
  createdAt: string;
}

interface CompareData {
  insufficientProviders: false;
  providerA: ProviderInfo;
  providerB: ProviderInfo;
  allProviders: ProviderInfo[];
  overallAgreementScore: number;
  moduleComparisons: ModuleComparison[];
}

interface InsufficientData {
  insufficientProviders: true;
  availableProviders: string[];
  message: string;
}

type ApiResponse = CompareData | InsufficientData;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  'claude-api': 'Claude API',
  'claude-cli': 'Claude CLI',
  codex: 'Codex',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SeverityDot({ severity }: { severity: string }) {
  const colorMap: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-blue-400',
    info: 'bg-gray-400',
  };
  return (
    <span
      className={`mt-1 inline-block h-2 w-2 rounded-full shrink-0 ${colorMap[severity] ?? colorMap.info}`}
    />
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colorMap: Record<string, string> = {
    critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    info: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colorMap[severity] ?? colorMap.info}`}
    >
      {severity}
    </span>
  );
}

function AgreementScoreBar({ score }: { score: number }) {
  let barColor = 'bg-green-500';
  if (score < 50) barColor = 'bg-red-500';
  else if (score < 75) barColor = 'bg-yellow-500';

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums w-12 text-right">
        {score}%
      </span>
    </div>
  );
}

function FindingItem({ finding }: { finding: AuditFinding }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <SeverityDot severity={finding.severity} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{finding.message}</p>
        {finding.file && (
          <p className="text-xs text-muted-foreground font-mono">
            {finding.file}
            {finding.line != null ? `:${finding.line}` : ''}
          </p>
        )}
      </div>
      <SeverityBadge severity={finding.severity} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module Comparison Card
// ---------------------------------------------------------------------------

function ModuleComparisonCard({
  module: mod,
  providerALabel,
  providerBLabel,
}: {
  module: ModuleComparison;
  providerALabel: string;
  providerBLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const moduleName = mod.moduleId
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return (
    <Card
      className={
        mod.agreementScore < 50
          ? 'border-red-300 dark:border-red-700'
          : undefined
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{moduleName}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                mod.agreementScore >= 75
                  ? 'default'
                  : mod.agreementScore >= 50
                    ? 'secondary'
                    : 'destructive'
              }
            >
              {mod.agreementScore}% agree
            </Badge>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
        <AgreementScoreBar score={mod.agreementScore} />
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summaries side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {providerALabel} Summary
            </p>
            <p className="text-sm text-muted-foreground">
              {mod.summaryA ?? 'No summary available'}
            </p>
            <p className="text-xs text-muted-foreground">
              {mod.findingCountA} finding{mod.findingCountA !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {providerBLabel} Summary
            </p>
            <p className="text-sm text-muted-foreground">
              {mod.summaryB ?? 'No summary available'}
            </p>
            <p className="text-xs text-muted-foreground">
              {mod.findingCountB} finding{mod.findingCountB !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>{mod.agreements.length} agreed</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Eye className="h-4 w-4 text-blue-500" />
            <span>
              {mod.providerAOnly.length} {providerALabel} only
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Eye className="h-4 w-4 text-purple-500" />
            <span>
              {mod.providerBOnly.length} {providerBLabel} only
            </span>
          </div>
        </div>

        {/* Expanded detail sections */}
        {expanded && (
          <div className="space-y-6 pt-2">
            {/* Agreements */}
            {mod.agreements.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Agreements ({mod.agreements.length})
                </h4>
                <div className="space-y-3">
                  {mod.agreements.map((ag) => (
                    <div
                      key={ag.key}
                      className="rounded-lg border border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-950/20 p-3"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            {providerALabel}
                          </p>
                          {ag.findingsA.map((f, i) => (
                            <FindingItem key={i} finding={f} />
                          ))}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            {providerBLabel}
                          </p>
                          {ag.findingsB.map((f, i) => (
                            <FindingItem key={i} finding={f} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Provider A only (disagreements) */}
            {mod.providerAOnly.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {providerALabel} Only ({mod.providerAOnly.length})
                </h4>
                <div className="space-y-2">
                  {mod.providerAOnly.map((group) =>
                    group.findings.map((f, i) => (
                      <div
                        key={`${group.key}-${i}`}
                        className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 p-3"
                      >
                        <FindingItem finding={f} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Provider B only (disagreements) */}
            {mod.providerBOnly.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {providerBLabel} Only ({mod.providerBOnly.length})
                </h4>
                <div className="space-y-2">
                  {mod.providerBOnly.map((group) =>
                    group.findings.map((f, i) => (
                      <div
                        key={`${group.key}-${i}`}
                        className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/20 p-3"
                      >
                        <FindingItem finding={f} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* No findings case */}
            {mod.agreements.length === 0 &&
              mod.providerAOnly.length === 0 &&
              mod.providerBOnly.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Neither provider found issues in this module.
                </p>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function CompareAuditsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [data, setData] = useState<CompareData | null>(null);
  const [insufficient, setInsufficient] = useState<InsufficientData | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchComparison() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/repos/${id}/compare-audits`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || 'Failed to load comparison data');
        }
        const result: ApiResponse = await res.json();
        if (result.insufficientProviders) {
          setInsufficient(result);
          setData(null);
        } else {
          setData(result);
          setInsufficient(null);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load comparison'
        );
      } finally {
        setLoading(false);
      }
    }

    fetchComparison();
  }, [id]);

  // Loading
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
            Cross-Model Audit Comparison
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

  // Error
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
            Cross-Model Audit Comparison
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

  // Insufficient providers
  if (insufficient) {
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
            Cross-Model Audit Comparison
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-muted p-4">
                <XCircle className="h-10 w-10 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">
                  Need Audits From Multiple Providers
                </h3>
                <p className="text-muted-foreground max-w-md">
                  {insufficient.message}
                </p>
              </div>
              {insufficient.availableProviders.length > 0 && (
                <div className="flex gap-2">
                  {insufficient.availableProviders.map((p) => (
                    <Badge key={p} variant="outline">
                      {providerLabel(p)}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Run audits with at least two different providers (e.g. Claude API
                and Codex) to compare their findings.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const providerALabel = providerLabel(data.providerA.provider);
  const providerBLabel = providerLabel(data.providerB.provider);

  // Count total disagreements
  const totalDisagreements = data.moduleComparisons.reduce(
    (sum, m) => sum + m.providerAOnly.length + m.providerBOnly.length,
    0
  );
  const totalAgreements = data.moduleComparisons.reduce(
    (sum, m) => sum + m.agreements.length,
    0
  );

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
        <h1 className="text-3xl font-bold tracking-tight">
          Cross-Model Audit Comparison
        </h1>
        <p className="text-muted-foreground">
          Where do {providerALabel} and {providerBLabel} disagree?
        </p>
      </div>

      {/* Provider Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Provider A</CardDescription>
            <CardTitle className="text-lg">{providerALabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {data.providerA.model && (
                <Badge variant="outline">{data.providerA.model}</Badge>
              )}
              <span>{formatDate(data.providerA.createdAt)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Provider B</CardDescription>
            <CardTitle className="text-lg">{providerBLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {data.providerB.model && (
                <Badge variant="outline">{data.providerB.model}</Badge>
              )}
              <span>{formatDate(data.providerB.createdAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Overall Agreement Score */}
      <Card
        className={
          data.overallAgreementScore < 50
            ? 'border-red-300 dark:border-red-700 border-2'
            : undefined
        }
      >
        <CardHeader>
          <CardTitle>Overall Agreement</CardTitle>
          <CardDescription>
            How much do {providerALabel} and {providerBLabel} agree across all
            modules?
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AgreementScoreBar score={data.overallAgreementScore} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-green-600">
                {totalAgreements}
              </p>
              <p className="text-sm text-muted-foreground">Agreements</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">
                {totalDisagreements}
              </p>
              <p className="text-sm text-muted-foreground">Disagreements</p>
            </div>
            <div>
              <p className="text-2xl font-bold">
                {data.moduleComparisons.length}
              </p>
              <p className="text-sm text-muted-foreground">Modules Compared</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-Module Comparisons */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Module-by-Module Comparison</h2>
        {data.moduleComparisons.map((mod) => (
          <ModuleComparisonCard
            key={mod.moduleId}
            module={mod}
            providerALabel={providerALabel}
            providerBLabel={providerBLabel}
          />
        ))}
      </div>
    </div>
  );
}
