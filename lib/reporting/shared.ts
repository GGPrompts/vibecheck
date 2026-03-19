/**
 * Shared types and utility functions for report generation.
 *
 * Used by both the HTML and Markdown renderers as well as
 * the main generator orchestrator.
 */

import { mapToBusinessRisk, getSeverityLevels } from './risk-mapping';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoRow {
  id: string;
  name: string;
  path: string;
  overallScore: number | null;
  lastScanAt: string | null;
}

export interface ScanRow {
  id: string;
  repoId: string | null;
  status: string;
  overallScore: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface ModuleResultRow {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  metrics: string | null;
}

export interface FindingRow {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

export interface ModuleWithFindings extends ModuleResultRow {
  findings: FindingRow[];
}

export interface ScanWithModules {
  scan: ScanRow;
  modules: ModuleWithFindings[];
}

export interface ScanReportData {
  repo: RepoRow;
  scan: ScanRow;
  modules: ModuleWithFindings[];
  previousScan: ScanWithModules | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function trendArrow(current: number, previous: number): string {
  if (current > previous) return '\u2191'; // up
  if (current < previous) return '\u2193'; // down
  return '\u2192'; // right
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function todayFormatted(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  if (score >= 40) return '#ea580c';
  return '#dc2626';
}

export function computeTrend(scanDetails: ScanWithModules[]): 'improving' | 'declining' | 'stable' {
  if (scanDetails.length < 2) return 'stable';
  const latest = scanDetails[0].scan.overallScore ?? 0;
  const previous = scanDetails[1].scan.overallScore ?? 0;
  if (latest > previous) return 'improving';
  if (latest < previous) return 'declining';
  return 'stable';
}

export function computeTrendFromScores(
  current: number | null,
  previous: number | null,
): 'improving' | 'declining' | 'stable' {
  if (current === null || previous === null) return 'stable';
  if (current > previous) return 'improving';
  if (current < previous) return 'declining';
  return 'stable';
}

export function trendLabel(trend: 'improving' | 'declining' | 'stable'): string {
  switch (trend) {
    case 'improving':
      return 'Improving';
    case 'declining':
      return 'Declining';
    case 'stable':
      return 'Stable';
  }
}

export function trendEmoji(trend: 'improving' | 'declining' | 'stable'): string {
  return trend === 'improving' ? '\u2191' : trend === 'declining' ? '\u2193' : '\u2192';
}

export function trendCssClass(trend: 'improving' | 'declining' | 'stable'): string {
  return trend === 'improving' ? 'trend-up' : trend === 'declining' ? 'trend-down' : 'trend-same';
}

export function arrowCssClass(arrow: string): string {
  return arrow === '\u2191' ? 'trend-up' : arrow === '\u2193' ? 'trend-down' : 'trend-same';
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

export function sortFindingsBySeverity(findingsList: FindingRow[]): FindingRow[] {
  const severityOrder = getSeverityLevels();
  return [...findingsList].sort((a, b) => {
    const aIdx = severityOrder.indexOf(a.severity.toLowerCase());
    const bIdx = severityOrder.indexOf(b.severity.toLowerCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });
}

export function countSeverities(findingsList: FindingRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findingsList) {
    const key = f.severity.toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function getTopRisks(scanDetails: ScanWithModules[]): FindingRow[] {
  if (scanDetails.length === 0) return [];
  const allFindings = scanDetails[0].modules.flatMap((m) => m.findings);
  return sortFindingsBySeverity(allFindings).slice(0, 3);
}

export function getAllFindingsBySeverity(scanDetails: ScanWithModules[]): FindingRow[] {
  if (scanDetails.length === 0) return [];
  const allFindings = scanDetails[0].modules.flatMap((m) => m.findings);
  return sortFindingsBySeverity(allFindings).slice(0, 20);
}

/**
 * Parse a metrics JSON string and return key-value entries.
 * Returns an empty array on parse failure or empty objects.
 */
export function parseMetrics(metricsJson: string | null): [string, number][] {
  if (!metricsJson) return [];
  try {
    const parsed = JSON.parse(metricsJson) as Record<string, number>;
    const entries = Object.entries(parsed);
    return entries.length > 0 ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Humanize a camelCase / snake_case / kebab-case metric key.
 */
export function formatMetricLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * Compute severity color map for SVG charts.
 */
export const SEVERITY_COLOR_MAP: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#d97706',
  low: '#2563eb',
  info: '#6b7280',
};
