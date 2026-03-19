"use client";

import { useEffect, useState, useMemo, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, BarChart3, GitCompareArrows } from "lucide-react";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface Scan {
  id: string;
  repoId: string | null;
  repoName: string | null;
  status: string;
  overallScore: number | null;
  durationMs: number | null;
  createdAt: string;
}

interface Finding {
  id: string;
  fingerprint: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

interface ModuleResult {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  metrics: Record<string, unknown> | null;
  findings: Finding[];
}

interface ScanDetail {
  scan: {
    id: string;
    repoId: string | null;
    status: string;
    overallScore: number | null;
    durationMs: number | null;
    createdAt: string;
  };
  modules: ModuleResult[];
}

interface ModuleScorePoint {
  date: string;
  rawDate: string;
  [key: string]: string | number | undefined;
}

interface FindingStatusPoint {
  date: string;
  rawDate: string;
  new: number;
  recurring: number;
  fixed: number;
  regressed: number;
}

const MODULE_COLORS: Record<string, string> = {
  "code-quality": "#6366f1",
  "dependency-health": "#f59e0b",
  "test-coverage": "#10b981",
  "documentation": "#3b82f6",
  "security": "#ef4444",
  "architecture": "#8b5cf6",
  "performance": "#ec4899",
  "accessibility": "#14b8a6",
};

const DEFAULT_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getModuleColor(moduleId: string, index: number): string {
  return MODULE_COLORS[moduleId] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export default function TrendsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [scans, setScans] = useState<Scan[]>([]);
  const [scanDetails, setScanDetails] = useState<Map<string, ScanDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [compareScanA, setCompareScanA] = useState<string>("");
  const [compareScanB, setCompareScanB] = useState<string>("");

  // Fetch all scans and filter by repoId
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const scansRes = await fetch("/api/scans");
        if (!scansRes.ok) throw new Error("Failed to fetch scans");

        const allScans: Scan[] = await scansRes.json();
        const repoScans = allScans
          .filter((s) => s.repoId === id && s.status === "complete")
          .sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

        setScans(repoScans);

        // Fetch module results for each completed scan
        const detailsMap = new Map<string, ScanDetail>();
        const detailPromises = repoScans.map(async (scan) => {
          try {
            const res = await fetch(`/api/scans/${scan.id}`);
            if (res.ok) {
              const detail: ScanDetail = await res.json();
              detailsMap.set(scan.id, detail);
            }
          } catch {
            // Skip scans that fail to fetch details
          }
        });

        await Promise.all(detailPromises);
        setScanDetails(detailsMap);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trend data");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  // Collect all unique module IDs
  const allModuleIds = useMemo(() => {
    const moduleSet = new Set<string>();
    scanDetails.forEach((detail) => {
      detail.modules.forEach((m) => moduleSet.add(m.moduleId));
    });
    return Array.from(moduleSet).sort();
  }, [scanDetails]);

  // Build module score trend data
  const moduleScoreData: ModuleScorePoint[] = useMemo(() => {
    return scans
      .filter((scan) => scanDetails.has(scan.id))
      .map((scan) => {
        const detail = scanDetails.get(scan.id)!;
        const point: ModuleScorePoint = {
          date: formatDate(scan.createdAt),
          rawDate: scan.createdAt,
        };
        detail.modules.forEach((m) => {
          point[m.moduleId] = m.score;
        });
        return point;
      });
  }, [scans, scanDetails]);

  // Build finding status data
  const findingStatusData: FindingStatusPoint[] = useMemo(() => {
    return scans
      .filter((scan) => scanDetails.has(scan.id))
      .map((scan) => {
        const detail = scanDetails.get(scan.id)!;
        const counts = { new: 0, recurring: 0, fixed: 0, regressed: 0 };
        detail.modules.forEach((m) => {
          m.findings.forEach((f) => {
            const status = f.status as keyof typeof counts;
            if (status in counts) {
              counts[status]++;
            }
          });
        });
        return {
          date: formatDate(scan.createdAt),
          rawDate: scan.createdAt,
          ...counts,
        };
      });
  }, [scans, scanDetails]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const completedScans = scans.filter((s) => s.overallScore !== null);
    const scores = completedScans.map((s) => s.overallScore!);

    if (scores.length === 0) {
      return {
        totalScans: scans.length,
        avgScore: null,
        bestScore: null,
        worstScore: null,
        trend: "stable" as const,
      };
    }

    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const best = Math.max(...scores);
    const worst = Math.min(...scores);

    let trend: "improving" | "declining" | "stable" = "stable";
    if (scores.length >= 2) {
      const last = scores[scores.length - 1];
      const prev = scores[scores.length - 2];
      if (last > prev) trend = "improving";
      else if (last < prev) trend = "declining";
    }

    return {
      totalScans: scans.length,
      avgScore: avg,
      bestScore: best,
      worstScore: worst,
      trend,
    };
  }, [scans]);

  const TrendIcon =
    summaryStats.trend === "improving"
      ? TrendingUp
      : summaryStats.trend === "declining"
        ? TrendingDown
        : Minus;

  const trendColor =
    summaryStats.trend === "improving"
      ? "text-green-500"
      : summaryStats.trend === "declining"
        ? "text-red-500"
        : "text-muted-foreground";

  const trendLabel =
    summaryStats.trend === "improving"
      ? "Improving"
      : summaryStats.trend === "declining"
        ? "Declining"
        : "Stable";

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
          <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
          <p className="text-muted-foreground">Loading historical data...</p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-64 rounded-xl bg-muted/50 animate-pulse"
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
            href={`/repo/${id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to repository
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
        </div>
        <Card>
          <CardContent>
            <p className="text-destructive py-4">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Empty state: fewer than 2 scans
  if (scans.length < 2) {
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
          <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
          <p className="text-muted-foreground">
            Historical health data for this repository
          </p>
        </div>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <BarChart3 className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Not enough data for trends
              </h3>
              <p className="text-muted-foreground max-w-md">
                Run at least 2 scans to see historical charts. Trends will show
                module score changes, finding status distribution, and summary
                statistics over time.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold tracking-tight">Trends</h1>
        <p className="text-muted-foreground">
          Historical health data across {scans.length} scans
        </p>
      </div>

      {/* Scan Comparison Picker */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5" />
            Compare Scans
          </CardTitle>
          <CardDescription>
            Select two scans to see a detailed side-by-side comparison
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className="flex-1 w-full sm:w-auto space-y-1.5">
              <label htmlFor="scan-a" className="text-sm font-medium text-muted-foreground">
                Scan A (baseline)
              </label>
              <select
                id="scan-a"
                value={compareScanA}
                onChange={(e) => setCompareScanA(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Select a scan...</option>
                {scans.map((scan) => (
                  <option key={scan.id} value={scan.id}>
                    {formatDate(scan.createdAt)} — Score: {scan.overallScore ?? "N/A"}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 w-full sm:w-auto space-y-1.5">
              <label htmlFor="scan-b" className="text-sm font-medium text-muted-foreground">
                Scan B (latest)
              </label>
              <select
                id="scan-b"
                value={compareScanB}
                onChange={(e) => setCompareScanB(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">Select a scan...</option>
                {scans.map((scan) => (
                  <option key={scan.id} value={scan.id}>
                    {formatDate(scan.createdAt)} — Score: {scan.overallScore ?? "N/A"}
                  </option>
                ))}
              </select>
            </div>
            <button
              disabled={!compareScanA || !compareScanB || compareScanA === compareScanB}
              onClick={() => {
                router.push(`/repo/${id}/compare?a=${compareScanA}&b=${compareScanB}`);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 transition-colors"
            >
              <GitCompareArrows className="h-4 w-4" />
              Compare
            </button>
          </div>
          {compareScanA && compareScanB && compareScanA === compareScanB && (
            <p className="text-xs text-destructive mt-2">
              Please select two different scans to compare.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Module Score Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Module Score Trends</CardTitle>
          <CardDescription>
            How each module&apos;s score has changed over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          {moduleScoreData.length > 0 && allModuleIds.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart
                data={moduleScoreData}
                margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend />
                {allModuleIds.map((moduleId, index) => (
                  <Line
                    key={moduleId}
                    type="monotone"
                    dataKey={moduleId}
                    name={moduleId}
                    stroke={getModuleColor(moduleId, index)}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No module data available yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Finding Status Stacked Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Finding Status Distribution</CardTitle>
          <CardDescription>
            How finding composition changes over time
          </CardDescription>
        </CardHeader>
        <CardContent>
          {findingStatusData.some(
            (d) => d.new + d.recurring + d.fixed + d.regressed > 0
          ) ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart
                data={findingStatusData}
                margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="fixed"
                  name="Fixed"
                  stackId="1"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="recurring"
                  name="Recurring"
                  stackId="1"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="regressed"
                  name="Regressed"
                  stackId="1"
                  stroke="#f97316"
                  fill="#f97316"
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="new"
                  name="New"
                  stackId="1"
                  stroke="#ef4444"
                  fill="#ef4444"
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No findings data available yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Total Scans</CardDescription>
            <CardTitle className="text-2xl">{summaryStats.totalScans}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Average Score</CardDescription>
            <CardTitle className="text-2xl">
              {summaryStats.avgScore !== null ? summaryStats.avgScore : "--"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Best Score</CardDescription>
            <CardTitle className="text-2xl text-green-500">
              {summaryStats.bestScore !== null ? summaryStats.bestScore : "--"}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Worst Score</CardDescription>
            <CardTitle className="text-2xl text-red-500">
              {summaryStats.worstScore !== null ? summaryStats.worstScore : "--"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Trend Direction */}
      {summaryStats.avgScore !== null && (
        <Card>
          <CardContent>
            <div className="flex items-center gap-3 py-2">
              <TrendIcon className={`h-5 w-5 ${trendColor}`} />
              <div>
                <p className="text-sm font-medium">
                  Score trend:{" "}
                  <span className={trendColor}>{trendLabel}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Based on the last 2 scans
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
