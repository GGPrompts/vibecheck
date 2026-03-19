/**
 * Multi-format report generator.
 *
 * Produces professional Markdown or self-contained HTML reports for both
 * compliance-focused views (by repository) and general-purpose scan reports
 * (by scan ID). Suitable for executive review, Confluence/Notion, GitHub
 * issues, or email distribution.
 */

import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { repos, scans, moduleResults, findings } from '@/lib/db/schema';
import { getSeverityLevels } from './risk-mapping';
import { generateScoreGauge, generateModuleBarChart, generateSeverityBar } from './chart-svg';
import { renderStandaloneHtml } from './html-template';
import type { StandaloneReportData } from './html-template';
import {
  escapeHtml,
  trendArrow,
  formatDate,
  formatDuration,
  todayFormatted,
  computeTrend,
  computeTrendFromScores,
  trendLabel,
  trendEmoji,
  trendCssClass,
  sortFindingsBySeverity,
  countSeverities,
  getTopRisks,
  getAllFindingsBySeverity,
  SEVERITY_COLOR_MAP,
  type RepoRow,
  type ScanRow,
  type ModuleResultRow,
  type FindingRow,
  type ModuleWithFindings,
  type ScanWithModules,
  type ScanReportData,
} from './shared';
import {
  REPORT_CSS,
  htmlDocOpen,
  htmlDocClose,
  renderHtmlHeader,
  renderHtmlTopRisks,
  renderHtmlModuleTable,
  renderHtmlModuleRows,
  renderHtmlFindingsTable,
  renderHtmlFindingsRows,
  renderHtmlSeverityBreakdown,
  renderHtmlSeverityListItems,
  renderHtmlMetricsSection,
  renderHtmlMetricsInner,
  renderHtmlScanHistory,
} from './html-renderer';
import {
  renderMdModuleTable,
  renderMdFindingsTable,
  renderMdSeverityBreakdown,
  renderMdTopRisks,
  renderMdMetricsSection,
} from './markdown-renderer';

// ---------------------------------------------------------------------------
// Re-export public type
// ---------------------------------------------------------------------------

export type ScanReportFormat = 'md' | 'html' | 'html-standalone';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadModulesForScan(scanId: string): ModuleWithFindings[] {
  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scanId))
    .all() as ModuleResultRow[];

  return results.map((mr) => {
    const mFindings = db
      .select()
      .from(findings)
      .where(eq(findings.moduleResultId, mr.id))
      .all() as FindingRow[];
    return { ...mr, findings: mFindings };
  });
}

function loadReportData(repoId: string) {
  const repo = db.select().from(repos).where(eq(repos.id, repoId)).get() as RepoRow | undefined;
  if (!repo) throw new Error(`Repository not found: ${repoId}`);

  const allScans = db
    .select()
    .from(scans)
    .where(eq(scans.repoId, repoId))
    .orderBy(desc(scans.createdAt))
    .all() as ScanRow[];

  const scanDetails: ScanWithModules[] = allScans
    .filter((s) => s.status === 'completed')
    .map((scan) => ({ scan, modules: loadModulesForScan(scan.id) }));

  return { repo, allScans, scanDetails };
}

function loadScanReportData(scanId: string): ScanReportData {
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get() as ScanRow | undefined;
  if (!scan) throw new Error(`Scan not found: ${scanId}`);
  if (!scan.repoId) throw new Error(`Scan ${scanId} has no associated repository`);

  const repo = db.select().from(repos).where(eq(repos.id, scan.repoId)).get() as RepoRow | undefined;
  if (!repo) throw new Error(`Repository not found for scan: ${scanId}`);

  const modules = loadModulesForScan(scanId);

  // Load previous completed scan for trend comparison
  const allScans = db
    .select()
    .from(scans)
    .where(eq(scans.repoId, scan.repoId))
    .orderBy(desc(scans.createdAt))
    .all() as ScanRow[];

  let previousScan: ScanWithModules | null = null;
  for (const s of allScans) {
    if (s.id !== scanId && s.status === 'completed') {
      previousScan = { scan: s, modules: loadModulesForScan(s.id) };
      break;
    }
  }

  return { repo, scan, modules, previousScan };
}

// ---------------------------------------------------------------------------
// Markdown generators
// ---------------------------------------------------------------------------

function generateMarkdown(repoId: string): string {
  const { repo, scanDetails } = loadReportData(repoId);
  const latestScore = scanDetails[0]?.scan.overallScore ?? null;
  const trend = computeTrend(scanDetails);
  const topRisks = getTopRisks(scanDetails);
  const topFindings = getAllFindingsBySeverity(scanDetails);
  const now = todayFormatted();

  const lines: string[] = [];

  lines.push(`# VibeCheck Compliance Report`);
  lines.push('');
  lines.push(`**Repository:** ${repo.name}`);
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Scans Analysed:** ${scanDetails.length}`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push(
    `The overall health score for **${repo.name}** is **${latestScore ?? 'N/A'}**/100. ` +
      `The trend is **${trendLabel(trend)}** based on the most recent scans.`
  );
  lines.push('');

  lines.push(renderMdTopRisks(topRisks));

  if (scanDetails.length > 0) {
    const latest = scanDetails[0];
    const previous = scanDetails.length > 1 ? scanDetails[1] : null;
    lines.push(renderMdModuleTable(latest.modules, previous?.modules ?? null));
  }

  lines.push(renderMdFindingsTable(topFindings));

  if (scanDetails.length > 0) {
    const allFindingsList = scanDetails[0].modules.flatMap((m) => m.findings);
    const severityCounts = countSeverities(allFindingsList);
    lines.push(renderMdSeverityBreakdown(severityCounts));
  }

  lines.push('---');
  lines.push('*Report generated by VibeCheck — Repository Health Scanner*');

  return lines.join('\n');
}

function generateScanMarkdown(scanId: string): string {
  const { repo, scan, modules, previousScan } = loadScanReportData(scanId);

  const allFindings = modules.flatMap((m) => m.findings);
  const sortedFindings = sortFindingsBySeverity(allFindings);
  const now = todayFormatted();

  const prevScore = previousScan?.scan.overallScore ?? null;
  const arrow =
    scan.overallScore !== null && prevScore !== null
      ? trendArrow(scan.overallScore, prevScore)
      : '';

  const lines: string[] = [];

  lines.push(`# VibeCheck Scan Report`);
  lines.push('');
  lines.push(`**Repository:** ${repo.name}`);
  lines.push(`**Scan ID:** \`${scan.id}\``);
  lines.push(`**Scanned:** ${formatDate(scan.createdAt)}`);
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Duration:** ${formatDuration(scan.durationMs)}`);
  lines.push(`**Status:** ${scan.status}`);
  lines.push('');

  lines.push('## Overall Score');
  lines.push('');
  const scoreStr = scan.overallScore !== null ? `${scan.overallScore}/100` : 'N/A';
  const trendStr = arrow ? ` ${arrow}` : '';
  const prevStr = prevScore !== null ? ` (previous: ${prevScore}/100)` : '';
  lines.push(`**${scoreStr}**${trendStr}${prevStr}`);
  lines.push('');

  if (modules.length > 0) {
    lines.push(renderMdModuleTable(modules, previousScan?.modules ?? null, { showFindings: true }));
  }

  lines.push(renderMdMetricsSection(modules));
  lines.push(renderMdFindingsTable(sortedFindings));

  const severityCounts = countSeverities(allFindings);
  lines.push(renderMdSeverityBreakdown(severityCounts, { title: 'Severity Breakdown', useUrgency: true }));

  lines.push('---');
  lines.push('*Report generated by VibeCheck -- Repository Health Scanner*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML generators
// ---------------------------------------------------------------------------

function generateHtml(repoId: string): string {
  const { repo, scanDetails } = loadReportData(repoId);
  const latestScore = scanDetails[0]?.scan.overallScore ?? null;
  const trend = computeTrend(scanDetails);
  const topRisks = getTopRisks(scanDetails);
  const topFindings = getAllFindingsBySeverity(scanDetails);
  const now = todayFormatted();

  const parts: string[] = [];

  parts.push(htmlDocOpen(`VibeCheck Report \u2014 ${escapeHtml(repo.name)}`, REPORT_CSS));

  // Header
  const headerMeta = [
    { label: 'Overall Score', value: `${latestScore ?? 'N/A'}<span style="font-size:14px;opacity:0.6">/100</span>` },
    { label: 'Trend', value: `${trendEmoji(trend)} ${escapeHtml(trendLabel(trend))}`, cssClass: trendCssClass(trend) },
    { label: 'Scans', value: `${scanDetails.length}` },
  ];
  if (scanDetails[0]?.scan.durationMs) {
    headerMeta.push({ label: 'Last Scan Duration', value: formatDuration(scanDetails[0].scan.durationMs) });
  }
  parts.push(renderHtmlHeader('VibeCheck Compliance Report', `${escapeHtml(repo.name)} &mdash; ${escapeHtml(now)}`, headerMeta));

  // Executive Summary
  parts.push('<div class="section">');
  parts.push('<h2>Executive Summary</h2>');
  parts.push(`<p class="summary-text">The overall health score for <strong>${escapeHtml(repo.name)}</strong> is <strong>${latestScore ?? 'N/A'}</strong>/100. The trend is <strong>${escapeHtml(trendLabel(trend))}</strong> based on the most recent scans.</p>`);
  parts.push(renderHtmlTopRisks(topRisks));
  parts.push('</div>');

  // Module Scores
  if (scanDetails.length > 0) {
    const latest = scanDetails[0];
    const previous = scanDetails.length > 1 ? scanDetails[1] : null;
    parts.push(renderHtmlModuleTable(latest.modules, previous?.modules ?? null));
  }

  // Top Findings
  parts.push(renderHtmlFindingsTable(topFindings));

  // Risk Assessment Summary
  if (scanDetails.length > 0) {
    const allFindingsList = scanDetails[0].modules.flatMap((m) => m.findings);
    const severityCounts = countSeverities(allFindingsList);
    parts.push(renderHtmlSeverityBreakdown(severityCounts));
  }

  // Scan History
  parts.push(renderHtmlScanHistory(scanDetails));

  parts.push(htmlDocClose());

  return parts.join('\n');
}

function generateScanHtml(scanId: string): string {
  const { repo, scan, modules, previousScan } = loadScanReportData(scanId);

  const allFindings = modules.flatMap((m) => m.findings);
  const sortedFindings = sortFindingsBySeverity(allFindings);
  const now = todayFormatted();

  const prevScore = previousScan?.scan.overallScore ?? null;
  const trendDir = computeTrendFromScores(scan.overallScore, prevScore);

  const parts: string[] = [];

  parts.push(htmlDocOpen(`VibeCheck Scan Report &mdash; ${escapeHtml(repo.name)}`, REPORT_CSS));

  // Header
  const headerMeta = [
    { label: 'Overall Score', value: `${scan.overallScore ?? 'N/A'}<span style="font-size:14px;opacity:0.6">/100</span>` },
    { label: 'Trend', value: `${trendEmoji(trendDir)} ${escapeHtml(trendLabel(trendDir))}`, cssClass: trendCssClass(trendDir) },
    { label: 'Modules', value: `${modules.length}` },
    { label: 'Findings', value: `${allFindings.length}` },
  ];
  if (scan.durationMs) {
    headerMeta.push({ label: 'Duration', value: formatDuration(scan.durationMs) });
  }
  parts.push(renderHtmlHeader('VibeCheck Scan Report', `${escapeHtml(repo.name)} &mdash; ${escapeHtml(now)}`, headerMeta));

  // Module Scores
  if (modules.length > 0) {
    parts.push(renderHtmlModuleTable(modules, previousScan?.modules ?? null, { showFindings: true }));
  }

  // Metrics
  parts.push(renderHtmlMetricsSection(modules));

  // Top Findings
  parts.push(renderHtmlFindingsTable(sortedFindings));

  // Severity Breakdown
  const severityCounts = countSeverities(allFindings);
  parts.push(renderHtmlSeverityBreakdown(severityCounts, { showUrgency: true, title: 'Severity Breakdown' }));

  parts.push(htmlDocClose());

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Standalone HTML (self-contained with embedded SVG charts)
// ---------------------------------------------------------------------------

function generateScanHtmlStandalone(scanId: string): string {
  const { repo, scan, modules, previousScan } = loadScanReportData(scanId);

  const allFindings = modules.flatMap((m) => m.findings);
  const sortedFindings = sortFindingsBySeverity(allFindings);
  const now = todayFormatted();

  const prevScore = previousScan?.scan.overallScore ?? null;
  const trendDir = computeTrendFromScores(scan.overallScore, prevScore);

  // Generate SVG charts
  const scoreGaugeSvg = generateScoreGauge(scan.overallScore ?? 0, 180);
  const moduleBarChartSvg = generateModuleBarChart(
    modules.map((m) => ({ moduleId: m.moduleId, score: m.score })),
    580,
  );

  const severityCounts = countSeverities(allFindings);
  const severityData = getSeverityLevels()
    .filter((sev) => (severityCounts[sev] || 0) > 0)
    .map((sev) => ({
      severity: sev,
      count: severityCounts[sev] || 0,
      color: SEVERITY_COLOR_MAP[sev] || '#6b7280',
    }));
  const severityBarSvg = generateSeverityBar(severityData, 580);

  // Build pre-rendered HTML fragments (inner content only — template adds wrappers)
  const moduleTableHtml = renderHtmlModuleRows(modules, previousScan?.modules ?? null, { showFindings: true });
  const findingsTableHtml = renderHtmlFindingsRows(sortedFindings, 20);
  const metricsHtml = renderHtmlMetricsInner(modules);
  const severityListHtml = renderHtmlSeverityListItems(severityCounts, { showUrgency: true });

  const templateData: StandaloneReportData = {
    repoName: repo.name,
    scanId: scan.id,
    scanDate: formatDate(scan.createdAt),
    generatedDate: now,
    overallScore: scan.overallScore,
    previousScore: prevScore,
    trend: trendDir,
    durationMs: scan.durationMs,
    moduleCount: modules.length,
    findingsCount: allFindings.length,
    scoreGaugeSvg,
    moduleBarChartSvg,
    severityBarSvg,
    moduleTableHtml,
    metricsHtml,
    findingsTableHtml,
    extraFindingsCount: Math.max(0, sortedFindings.length - 20),
    severityListHtml,
  };

  return renderStandaloneHtml(templateData);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a compliance report for a repository (legacy API).
 * Uses all completed scans for the given repo.
 */
export async function generateReport(
  repoId: string,
  format: 'markdown' | 'html'
): Promise<string> {
  if (format === 'markdown') {
    return generateMarkdown(repoId);
  }
  return generateHtml(repoId);
}

/**
 * Generate a general-purpose scan report for a specific scan.
 * Includes overall score, per-module scores with confidence,
 * top findings by priority, and metrics summary.
 */
export async function generateScanReport(
  scanId: string,
  format: ScanReportFormat
): Promise<string> {
  if (format === 'md') {
    return generateScanMarkdown(scanId);
  }
  if (format === 'html-standalone') {
    return generateScanHtmlStandalone(scanId);
  }
  return generateScanHtml(scanId);
}
