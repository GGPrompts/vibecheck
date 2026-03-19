"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Plus,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface ComparisonFinding {
  id: string;
  fingerprint: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
  moduleId: string;
}

interface ModuleDelta {
  moduleId: string;
  scoreA: number | null;
  scoreB: number | null;
  delta: number | null;
  summaryA: string | null;
  summaryB: string | null;
}

interface CompareData {
  scanA: {
    id: string;
    overallScore: number | null;
    createdAt: string;
    status: string;
  };
  scanB: {
    id: string;
    overallScore: number | null;
    createdAt: string;
    status: string;
  };
  overallDelta: {
    scoreA: number | null;
    scoreB: number | null;
    delta: number | null;
  };
  moduleDeltas: ModuleDelta[];
  newFindings: ComparisonFinding[];
  fixedFindings: ComparisonFinding[];
  unchangedFindings: ComparisonFinding[];
  summary: {
    newCount: number;
    fixedCount: number;
    unchangedCount: number;
  };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeltaIndicator({ delta }: { delta: number | null }) {
  if (delta === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (delta > 0)
    return (
      <span className="inline-flex items-center gap-1 text-green-600 font-semibold">
        <ArrowUpRight className="h-4 w-4" />+{delta}
      </span>
    );
  if (delta < 0)
    return (
      <span className="inline-flex items-center gap-1 text-red-600 font-semibold">
        <ArrowDownRight className="h-4 w-4" />{delta}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground font-medium">
      <Minus className="h-4 w-4" />0
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colorMap: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
    medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    low: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    info: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${colorMap[severity] || colorMap.info}`}
    >
      {severity}
    </span>
  );
}

function FindingsList({
  findings,
  emptyMessage,
}: {
  findings: ComparisonFinding[];
  emptyMessage: string;
}) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="divide-y">
      {findings.map((f) => (
        <div key={f.id} className="py-3 flex items-start gap-3">
          <SeverityBadge severity={f.severity} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{f.message}</p>
            <p className="text-xs text-muted-foreground">
              {f.moduleId}
              {f.filePath && (
                <>
                  {" -- "}
                  {f.filePath}
                  {f.line != null && `:${f.line}`}
                </>
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ComparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const aId = searchParams.get("a");
  const bId = searchParams.get("b");

  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aId || !bId) {
      setError("Both scan A and scan B must be specified via ?a=...&b=... query parameters.");
      setLoading(false);
      return;
    }

    async function fetchComparison() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/scans/compare?a=${aId}&b=${bId}`);
        if (!res.ok) {
          const body = await res.json();
          throw new Error(body.error || "Failed to load comparison data");
        }
        const result: CompareData = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load comparison");
      } finally {
        setLoading(false);
      }
    }

    fetchComparison();
  }, [aId, bId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/repo/${id}/trends`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to trends
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Scan Comparison</h1>
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

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/repo/${id}/trends`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to trends
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Scan Comparison</h1>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/repo/${id}/trends`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to trends
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Scan Comparison</h1>
        <p className="text-muted-foreground">
          Comparing scan from {formatDate(data.scanA.createdAt)} to{" "}
          {formatDate(data.scanB.createdAt)}
        </p>
      </div>

      {/* Overall Score Delta */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Scan A</p>
              <p className="text-3xl font-bold">
                {data.overallDelta.scoreA ?? "--"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(data.scanA.createdAt)}
              </p>
            </div>
            <div className="text-center px-8">
              <div className="text-2xl">
                <DeltaIndicator delta={data.overallDelta.delta} />
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">Scan B</p>
              <p className="text-3xl font-bold">
                {data.overallDelta.scoreB ?? "--"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(data.scanB.createdAt)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>New Findings</CardDescription>
            <CardTitle className="text-2xl text-red-600 flex items-center gap-2">
              <Plus className="h-5 w-5" />
              {data.summary.newCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Fixed Findings</CardDescription>
            <CardTitle className="text-2xl text-green-600 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              {data.summary.fixedCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Unchanged Findings</CardDescription>
            <CardTitle className="text-2xl text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              {data.summary.unchangedCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Module Score Deltas */}
      <Card>
        <CardHeader>
          <CardTitle>Module Score Comparison</CardTitle>
          <CardDescription>
            Score changes per module between the two scans
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.moduleDeltas.length > 0 ? (
            <div className="divide-y">
              {data.moduleDeltas.map((mod) => (
                <div
                  key={mod.moduleId}
                  className="py-3 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {mod.moduleId
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <span className="w-12 text-right tabular-nums text-muted-foreground">
                      {mod.scoreA ?? "--"}
                    </span>
                    <span className="text-muted-foreground">{"-->"}</span>
                    <span className="w-12 text-right tabular-nums">
                      {mod.scoreB ?? "--"}
                    </span>
                    <span className="w-16 text-right">
                      <DeltaIndicator delta={mod.delta} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No module data available.
            </p>
          )}
        </CardContent>
      </Card>

      {/* New Findings (in B, not in A) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-red-600" />
            New Findings
          </CardTitle>
          <CardDescription>
            Issues found in scan B that were not present in scan A
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FindingsList
            findings={data.newFindings}
            emptyMessage="No new findings -- great job!"
          />
        </CardContent>
      </Card>

      {/* Fixed Findings (in A, not in B) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Fixed Findings
          </CardTitle>
          <CardDescription>
            Issues present in scan A that have been resolved in scan B
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FindingsList
            findings={data.fixedFindings}
            emptyMessage="No findings were fixed between these scans."
          />
        </CardContent>
      </Card>

      {/* Unchanged Findings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            Unchanged Findings
          </CardTitle>
          <CardDescription>
            Issues present in both scans (matched by fingerprint)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FindingsList
            findings={data.unchangedFindings}
            emptyMessage="No unchanged findings."
          />
        </CardContent>
      </Card>
    </div>
  );
}
