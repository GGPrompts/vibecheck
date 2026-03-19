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
import { mapToBusinessRisk, getSeverityLevels } from './risk-mapping';
import { generateScoreGauge, generateModuleBarChart, generateSeverityBar } from './chart-svg';
import { renderStandaloneHtml } from './html-template';
import type { StandaloneReportData } from './html-template';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoRow {
  id: string;
  name: string;
  path: string;
  overallScore: number | null;
  lastScanAt: string | null;
}

interface ScanRow {
  id: string;
  repoId: string | null;
  status: string;
  overallScore: number | null;
  durationMs: number | null;
  createdAt: string;
}

interface ModuleResultRow {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  metrics: string | null;
}

interface FindingRow {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

interface ModuleWithFindings extends ModuleResultRow {
  findings: FindingRow[];
}

interface ScanWithModules {
  scan: ScanRow;
  modules: ModuleWithFindings[];
}

export type ScanReportFormat = 'md' | 'html' | 'html-standalone';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

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
    .filter((s) => s.status === 'complete')
    .map((scan) => {
      const results = db
        .select()
        .from(moduleResults)
        .where(eq(moduleResults.scanId, scan.id))
        .all() as ModuleResultRow[];

      const modules: ModuleWithFindings[] = results.map((mr) => {
        const mFindings = db
          .select()
          .from(findings)
          .where(eq(findings.moduleResultId, mr.id))
          .all() as FindingRow[];
        return { ...mr, findings: mFindings };
      });

      return { scan, modules };
    });

  return { repo, allScans, scanDetails };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trendArrow(current: number, previous: number): string {
  if (current > previous) return '\u2191'; // ↑
  if (current < previous) return '\u2193'; // ↓
  return '\u2192'; // →
}

function formatDuration(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  if (score >= 40) return '#ea580c';
  return '#dc2626';
}

function computeTrend(scanDetails: ScanWithModules[]): 'improving' | 'declining' | 'stable' {
  if (scanDetails.length < 2) return 'stable';
  const latest = scanDetails[0].scan.overallScore ?? 0;
  const previous = scanDetails[1].scan.overallScore ?? 0;
  if (latest > previous) return 'improving';
  if (latest < previous) return 'declining';
  return 'stable';
}

function trendLabel(trend: 'improving' | 'declining' | 'stable'): string {
  switch (trend) {
    case 'improving':
      return 'Improving';
    case 'declining':
      return 'Declining';
    case 'stable':
      return 'Stable';
  }
}

function getTopRisks(scanDetails: ScanWithModules[]): FindingRow[] {
  if (scanDetails.length === 0) return [];
  const latest = scanDetails[0];
  const allFindings = latest.modules.flatMap((m) => m.findings);

  const severityOrder = getSeverityLevels();
  allFindings.sort((a, b) => {
    const aIdx = severityOrder.indexOf(a.severity.toLowerCase());
    const bIdx = severityOrder.indexOf(b.severity.toLowerCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  return allFindings.slice(0, 3);
}

function getAllFindingsBySeverity(scanDetails: ScanWithModules[]): FindingRow[] {
  if (scanDetails.length === 0) return [];
  const latest = scanDetails[0];
  const allFindings = latest.modules.flatMap((m) => m.findings);

  const severityOrder = getSeverityLevels();
  allFindings.sort((a, b) => {
    const aIdx = severityOrder.indexOf(a.severity.toLowerCase());
    const bIdx = severityOrder.indexOf(b.severity.toLowerCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  return allFindings.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Markdown generator
// ---------------------------------------------------------------------------

function generateMarkdown(repoId: string): string {
  const { repo, scanDetails } = loadReportData(repoId);
  const latestScore = scanDetails[0]?.scan.overallScore ?? null;
  const trend = computeTrend(scanDetails);
  const topRisks = getTopRisks(scanDetails);
  const topFindings = getAllFindingsBySeverity(scanDetails);
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const lines: string[] = [];

  // Title
  lines.push(`# VibeCheck Compliance Report`);
  lines.push('');
  lines.push(`**Repository:** ${repo.name}`);
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Scans Analysed:** ${scanDetails.length}`);
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(
    `The overall health score for **${repo.name}** is **${latestScore ?? 'N/A'}**/100. ` +
      `The trend is **${trendLabel(trend)}** based on the most recent scans.`
  );
  lines.push('');

  if (topRisks.length > 0) {
    lines.push('### Top Risks');
    lines.push('');
    topRisks.forEach((f, i) => {
      const risk = mapToBusinessRisk(f.severity);
      lines.push(`${i + 1}. **${risk.label}** — ${f.message}`);
      if (f.filePath) {
        lines.push(`   - File: \`${f.filePath}${f.line ? `:${f.line}` : ''}\``);
      }
    });
    lines.push('');
  }

  // Module Scores
  if (scanDetails.length > 0) {
    lines.push('## Module Scores');
    lines.push('');
    lines.push('| Module | Score | Trend | Confidence | Summary |');
    lines.push('|--------|-------|-------|------------|---------|');

    const latest = scanDetails[0];
    const previous = scanDetails.length > 1 ? scanDetails[1] : null;

    for (const mod of latest.modules) {
      const prevMod = previous?.modules.find((m) => m.moduleId === mod.moduleId);
      const arrow = prevMod ? trendArrow(mod.score, prevMod.score) : '\u2192';
      const conf = `${Math.round(mod.confidence * 100)}%`;
      const summary = mod.summary ? mod.summary.replace(/\|/g, '/').substring(0, 80) : '-';
      lines.push(`| ${mod.moduleId} | ${mod.score}/100 | ${arrow} | ${conf} | ${summary} |`);
    }
    lines.push('');
  }

  // Top Findings
  if (topFindings.length > 0) {
    lines.push('## Top Findings');
    lines.push('');
    lines.push('| # | Severity | Category | Message | Location |');
    lines.push('|---|----------|----------|---------|----------|');

    topFindings.forEach((f, i) => {
      const risk = mapToBusinessRisk(f.severity);
      const loc = f.filePath ? `\`${f.filePath}${f.line ? `:${f.line}` : ''}\`` : '-';
      const msg = f.message.replace(/\|/g, '/').substring(0, 100);
      lines.push(`| ${i + 1} | ${risk.urgency} | ${f.category} | ${msg} | ${loc} |`);
    });
    lines.push('');
  }

  // Risk Assessment Summary
  if (scanDetails.length > 0) {
    const latest = scanDetails[0];
    const allFindings = latest.modules.flatMap((m) => m.findings);
    const severityCounts: Record<string, number> = {};
    for (const f of allFindings) {
      const key = f.severity.toLowerCase();
      severityCounts[key] = (severityCounts[key] || 0) + 1;
    }

    lines.push('## Risk Assessment Summary');
    lines.push('');
    for (const sev of getSeverityLevels()) {
      const count = severityCounts[sev] || 0;
      if (count > 0) {
        const risk = mapToBusinessRisk(sev);
        lines.push(`- **${risk.label}**: ${count} finding${count !== 1 ? 's' : ''}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Report generated by VibeCheck — Repository Health Scanner*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// HTML generator
// ---------------------------------------------------------------------------

function generateHtml(repoId: string): string {
  const { repo, scanDetails } = loadReportData(repoId);
  const latestScore = scanDetails[0]?.scan.overallScore ?? null;
  const trend = computeTrend(scanDetails);
  const topRisks = getTopRisks(scanDetails);
  const topFindings = getAllFindingsBySeverity(scanDetails);
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const css = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #f8f9fb; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 48px 40px; border-radius: 12px; margin-bottom: 32px; }
    .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .header .subtitle { font-size: 14px; opacity: 0.8; }
    .meta { display: flex; gap: 32px; margin-top: 20px; flex-wrap: wrap; }
    .meta-item { font-size: 13px; opacity: 0.9; }
    .meta-item strong { display: block; font-size: 22px; opacity: 1; margin-top: 2px; }
    .section { background: white; border-radius: 10px; padding: 28px 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #e5e7eb; }
    .section h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #1a1a2e; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    .section h3 { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #374151; }
    .summary-text { font-size: 15px; color: #374151; margin-bottom: 16px; }
    .risk-item { padding: 10px 14px; border-left: 4px solid; margin-bottom: 8px; border-radius: 0 6px 6px 0; background: #f9fafb; }
    .risk-item .risk-label { font-weight: 600; font-size: 13px; }
    .risk-item .risk-message { font-size: 14px; color: #374151; margin-top: 2px; }
    .risk-item .risk-file { font-size: 12px; color: #6b7280; font-family: monospace; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 10px 12px; background: #f3f4f6; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }
    tr:hover td { background: #f9fafb; }
    .score-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 600; font-size: 13px; color: white; }
    .trend-arrow { font-size: 16px; font-weight: 700; }
    .trend-up { color: #16a34a; }
    .trend-down { color: #dc2626; }
    .trend-same { color: #6b7280; }
    .severity-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; text-transform: uppercase; color: white; }
    .sev-critical { background: #dc2626; }
    .sev-high { background: #ea580c; }
    .sev-medium { background: #d97706; }
    .sev-low { background: #2563eb; }
    .sev-info { background: #6b7280; }
    .risk-summary-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .risk-summary-item:last-child { border-bottom: none; }
    .risk-count { font-size: 20px; font-weight: 700; min-width: 36px; }
    .risk-desc { font-size: 14px; color: #374151; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #9ca3af; }
    .mono { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 12px; color: #6b7280; }
    @media (max-width: 600px) { .container { padding: 16px; } .header { padding: 28px 20px; } .section { padding: 20px; } .meta { gap: 16px; } }
  `;

  const parts: string[] = [];

  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">');
  parts.push(`<title>VibeCheck Report — ${esc(repo.name)}</title>`);
  parts.push(`<style>${css}</style></head><body>`);
  parts.push('<div class="container">');

  // Header
  const trendEmoji = trend === 'improving' ? '\u2191' : trend === 'declining' ? '\u2193' : '\u2192';
  const trendCls = trend === 'improving' ? 'trend-up' : trend === 'declining' ? 'trend-down' : 'trend-same';

  parts.push('<div class="header">');
  parts.push(`<h1>VibeCheck Compliance Report</h1>`);
  parts.push(`<div class="subtitle">${esc(repo.name)} &mdash; ${esc(now)}</div>`);
  parts.push('<div class="meta">');
  parts.push(`<div class="meta-item">Overall Score<strong>${latestScore ?? 'N/A'}<span style="font-size:14px;opacity:0.6">/100</span></strong></div>`);
  parts.push(`<div class="meta-item">Trend<strong class="${trendCls}">${trendEmoji} ${esc(trendLabel(trend))}</strong></div>`);
  parts.push(`<div class="meta-item">Scans<strong>${scanDetails.length}</strong></div>`);
  if (scanDetails[0]?.scan.durationMs) {
    parts.push(`<div class="meta-item">Last Scan Duration<strong>${formatDuration(scanDetails[0].scan.durationMs)}</strong></div>`);
  }
  parts.push('</div></div>');

  // Executive Summary
  parts.push('<div class="section">');
  parts.push('<h2>Executive Summary</h2>');
  parts.push(`<p class="summary-text">The overall health score for <strong>${esc(repo.name)}</strong> is <strong>${latestScore ?? 'N/A'}</strong>/100. The trend is <strong>${esc(trendLabel(trend))}</strong> based on the most recent scans.</p>`);

  if (topRisks.length > 0) {
    parts.push('<h3>Top Risks</h3>');
    for (const f of topRisks) {
      const risk = mapToBusinessRisk(f.severity);
      parts.push(`<div class="risk-item" style="border-left-color: ${risk.color}">`);
      parts.push(`<div class="risk-label" style="color: ${risk.color}">${esc(risk.label)}</div>`);
      parts.push(`<div class="risk-message">${esc(f.message)}</div>`);
      if (f.filePath) {
        parts.push(`<div class="risk-file">${esc(f.filePath)}${f.line ? `:${f.line}` : ''}</div>`);
      }
      parts.push('</div>');
    }
  }
  parts.push('</div>');

  // Module Scores
  if (scanDetails.length > 0) {
    const latest = scanDetails[0];
    const previous = scanDetails.length > 1 ? scanDetails[1] : null;

    parts.push('<div class="section">');
    parts.push('<h2>Module Scores</h2>');
    parts.push('<table><thead><tr><th>Module</th><th>Score</th><th>Trend</th><th>Confidence</th><th>Summary</th></tr></thead><tbody>');

    for (const mod of latest.modules) {
      const prevMod = previous?.modules.find((m) => m.moduleId === mod.moduleId);
      const arrow = prevMod ? trendArrow(mod.score, prevMod.score) : '\u2192';
      const arrowCls =
        arrow === '\u2191' ? 'trend-up' : arrow === '\u2193' ? 'trend-down' : 'trend-same';
      const conf = `${Math.round(mod.confidence * 100)}%`;
      const summary = mod.summary ? esc(mod.summary.substring(0, 100)) : '&mdash;';
      const sc = scoreColor(mod.score);

      parts.push('<tr>');
      parts.push(`<td><strong>${esc(mod.moduleId)}</strong></td>`);
      parts.push(`<td><span class="score-badge" style="background:${sc}">${mod.score}</span></td>`);
      parts.push(`<td><span class="trend-arrow ${arrowCls}">${arrow}</span></td>`);
      parts.push(`<td>${conf}</td>`);
      parts.push(`<td>${summary}</td>`);
      parts.push('</tr>');
    }

    parts.push('</tbody></table></div>');
  }

  // Top Findings
  if (topFindings.length > 0) {
    parts.push('<div class="section">');
    parts.push('<h2>Top Findings</h2>');
    parts.push('<table><thead><tr><th>#</th><th>Severity</th><th>Category</th><th>Message</th><th>Location</th></tr></thead><tbody>');

    topFindings.forEach((f, i) => {
      const sevCls = `sev-${f.severity.toLowerCase()}`;
      const loc = f.filePath
        ? `<span class="mono">${esc(f.filePath)}${f.line ? `:${f.line}` : ''}</span>`
        : '&mdash;';
      const msg = esc(f.message.substring(0, 120));

      parts.push('<tr>');
      parts.push(`<td>${i + 1}</td>`);
      parts.push(`<td><span class="severity-badge ${sevCls}">${esc(f.severity)}</span></td>`);
      parts.push(`<td>${esc(f.category)}</td>`);
      parts.push(`<td>${msg}</td>`);
      parts.push(`<td>${loc}</td>`);
      parts.push('</tr>');
    });

    parts.push('</tbody></table></div>');
  }

  // Risk Assessment Summary
  if (scanDetails.length > 0) {
    const latest = scanDetails[0];
    const allFindings = latest.modules.flatMap((m) => m.findings);
    const severityCounts: Record<string, number> = {};
    for (const f of allFindings) {
      const key = f.severity.toLowerCase();
      severityCounts[key] = (severityCounts[key] || 0) + 1;
    }

    const hasCounts = Object.values(severityCounts).some((c) => c > 0);
    if (hasCounts) {
      parts.push('<div class="section">');
      parts.push('<h2>Risk Assessment Summary</h2>');

      for (const sev of getSeverityLevels()) {
        const count = severityCounts[sev] || 0;
        if (count > 0) {
          const risk = mapToBusinessRisk(sev);
          parts.push('<div class="risk-summary-item">');
          parts.push(`<span class="risk-count" style="color:${risk.color}">${count}</span>`);
          parts.push(`<span class="risk-desc">${esc(risk.label)}</span>`);
          parts.push('</div>');
        }
      }

      parts.push('</div>');
    }
  }

  // Scan History
  if (scanDetails.length > 1) {
    parts.push('<div class="section">');
    parts.push('<h2>Scan History</h2>');
    parts.push('<table><thead><tr><th>Date</th><th>Score</th><th>Duration</th><th>Modules</th></tr></thead><tbody>');

    for (const sd of scanDetails.slice(0, 10)) {
      const sc = sd.scan.overallScore;
      const scHtml =
        sc !== null
          ? `<span class="score-badge" style="background:${scoreColor(sc)}">${sc}</span>`
          : '&mdash;';

      parts.push('<tr>');
      parts.push(`<td>${esc(shortDate(sd.scan.createdAt))}</td>`);
      parts.push(`<td>${scHtml}</td>`);
      parts.push(`<td>${formatDuration(sd.scan.durationMs)}</td>`);
      parts.push(`<td>${sd.modules.length}</td>`);
      parts.push('</tr>');
    }

    parts.push('</tbody></table></div>');
  }

  // Footer
  parts.push('<div class="footer">Report generated by VibeCheck &mdash; Repository Health Scanner</div>');
  parts.push('</div></body></html>');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Scan-level data loading
// ---------------------------------------------------------------------------

interface ScanReportData {
  repo: RepoRow;
  scan: ScanRow;
  modules: ModuleWithFindings[];
  previousScan: ScanWithModules | null;
}

function loadScanReportData(scanId: string): ScanReportData {
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get() as ScanRow | undefined;
  if (!scan) throw new Error(`Scan not found: ${scanId}`);

  if (!scan.repoId) throw new Error(`Scan ${scanId} has no associated repository`);

  const repo = db.select().from(repos).where(eq(repos.id, scan.repoId)).get() as RepoRow | undefined;
  if (!repo) throw new Error(`Repository not found for scan: ${scanId}`);

  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scanId))
    .all() as ModuleResultRow[];

  const modules: ModuleWithFindings[] = results.map((mr) => {
    const mFindings = db
      .select()
      .from(findings)
      .where(eq(findings.moduleResultId, mr.id))
      .all() as FindingRow[];
    return { ...mr, findings: mFindings };
  });

  // Load previous completed scan for trend comparison
  const allScans = db
    .select()
    .from(scans)
    .where(eq(scans.repoId, scan.repoId))
    .orderBy(desc(scans.createdAt))
    .all() as ScanRow[];

  let previousScan: ScanWithModules | null = null;
  for (const s of allScans) {
    if (s.id !== scanId && s.status === 'complete') {
      const prevResults = db
        .select()
        .from(moduleResults)
        .where(eq(moduleResults.scanId, s.id))
        .all() as ModuleResultRow[];
      const prevModules: ModuleWithFindings[] = prevResults.map((mr) => {
        const mFindings = db
          .select()
          .from(findings)
          .where(eq(findings.moduleResultId, mr.id))
          .all() as FindingRow[];
        return { ...mr, findings: mFindings };
      });
      previousScan = { scan: s, modules: prevModules };
      break;
    }
  }

  return { repo, scan, modules, previousScan };
}

// ---------------------------------------------------------------------------
// Scan Report — Markdown
// ---------------------------------------------------------------------------

function generateScanMarkdown(scanId: string): string {
  const { repo, scan, modules, previousScan } = loadScanReportData(scanId);

  const allFindings = modules.flatMap((m) => m.findings);
  const severityOrder = getSeverityLevels();
  const sortedFindings = [...allFindings].sort((a, b) => {
    const aIdx = severityOrder.indexOf(a.severity.toLowerCase());
    const bIdx = severityOrder.indexOf(b.severity.toLowerCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const prevScore = previousScan?.scan.overallScore ?? null;
  const arrow =
    scan.overallScore !== null && prevScore !== null
      ? trendArrow(scan.overallScore, prevScore)
      : '';

  const lines: string[] = [];

  // Title & metadata
  lines.push(`# VibeCheck Scan Report`);
  lines.push('');
  lines.push(`**Repository:** ${repo.name}`);
  lines.push(`**Scan ID:** \`${scan.id}\``);
  lines.push(`**Scanned:** ${formatDate(scan.createdAt)}`);
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Duration:** ${formatDuration(scan.durationMs)}`);
  lines.push(`**Status:** ${scan.status}`);
  lines.push('');

  // Overall Score
  lines.push('## Overall Score');
  lines.push('');
  const scoreStr = scan.overallScore !== null ? `${scan.overallScore}/100` : 'N/A';
  const trendStr = arrow ? ` ${arrow}` : '';
  const prevStr =
    prevScore !== null ? ` (previous: ${prevScore}/100)` : '';
  lines.push(`**${scoreStr}**${trendStr}${prevStr}`);
  lines.push('');

  // Module Scores
  if (modules.length > 0) {
    lines.push('## Module Scores');
    lines.push('');
    lines.push('| Module | Score | Confidence | Findings | Summary |');
    lines.push('|--------|-------|------------|----------|---------|');

    for (const mod of modules) {
      const prevMod = previousScan?.modules.find((m) => m.moduleId === mod.moduleId);
      const modArrow = prevMod ? ` ${trendArrow(mod.score, prevMod.score)}` : '';
      const conf = `${Math.round(mod.confidence * 100)}%`;
      const fCount = mod.findings.length;
      const summary = mod.summary ? mod.summary.replace(/\|/g, '/').substring(0, 80) : '-';
      lines.push(
        `| ${mod.moduleId} | ${mod.score}/100${modArrow} | ${conf} | ${fCount} | ${summary} |`,
      );
    }
    lines.push('');
  }

  // Metrics Summary
  const metricsModules = modules.filter((m) => m.metrics);
  if (metricsModules.length > 0) {
    lines.push('## Metrics Summary');
    lines.push('');
    for (const mod of metricsModules) {
      let parsed: Record<string, number> = {};
      try {
        parsed = JSON.parse(mod.metrics!);
      } catch {
        continue;
      }
      const entries = Object.entries(parsed);
      if (entries.length === 0) continue;

      lines.push(`### ${mod.moduleId}`);
      lines.push('');
      lines.push('| Metric | Value |');
      lines.push('|--------|-------|');
      for (const [key, value] of entries) {
        const label = key
          .replace(/([A-Z])/g, ' $1')
          .replace(/[_-]/g, ' ')
          .replace(/^\w/, (c) => c.toUpperCase())
          .trim();
        lines.push(`| ${label} | ${typeof value === 'number' ? value.toLocaleString() : value} |`);
      }
      lines.push('');
    }
  }

  // Top Findings by priority
  const topFindings = sortedFindings.slice(0, 20);
  if (topFindings.length > 0) {
    lines.push('## Top Findings');
    lines.push('');
    lines.push('| # | Severity | Category | Message | Location |');
    lines.push('|---|----------|----------|---------|----------|');

    topFindings.forEach((f, i) => {
      const risk = mapToBusinessRisk(f.severity);
      const loc = f.filePath ? `\`${f.filePath}${f.line ? `:${f.line}` : ''}\`` : '-';
      const msg = f.message.replace(/\|/g, '/').substring(0, 100);
      lines.push(`| ${i + 1} | ${risk.urgency} | ${f.category} | ${msg} | ${loc} |`);
    });

    if (sortedFindings.length > 20) {
      lines.push('');
      lines.push(`*... and ${sortedFindings.length - 20} more findings*`);
    }
    lines.push('');
  }

  // Severity Breakdown
  const severityCounts: Record<string, number> = {};
  for (const f of allFindings) {
    const key = f.severity.toLowerCase();
    severityCounts[key] = (severityCounts[key] || 0) + 1;
  }
  const hasCounts = Object.values(severityCounts).some((c) => c > 0);

  if (hasCounts) {
    lines.push('## Severity Breakdown');
    lines.push('');
    for (const sev of severityOrder) {
      const count = severityCounts[sev] || 0;
      if (count > 0) {
        const risk = mapToBusinessRisk(sev);
        lines.push(`- **${risk.urgency}**: ${count} finding${count !== 1 ? 's' : ''}`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Report generated by VibeCheck -- Repository Health Scanner*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Scan Report — HTML
// ---------------------------------------------------------------------------

function generateScanHtml(scanId: string): string {
  const { repo, scan, modules, previousScan } = loadScanReportData(scanId);

  const allFindings = modules.flatMap((m) => m.findings);
  const severityOrder = getSeverityLevels();
  const sortedFindings = [...allFindings].sort((a, b) => {
    const aIdx = severityOrder.indexOf(a.severity.toLowerCase());
    const bIdx = severityOrder.indexOf(b.severity.toLowerCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const prevScore = previousScan?.scan.overallScore ?? null;
  const trendDir =
    scan.overallScore !== null && prevScore !== null
      ? scan.overallScore > prevScore
        ? 'improving'
        : scan.overallScore < prevScore
          ? 'declining'
          : 'stable'
      : 'stable';
  const trendEmoji = trendDir === 'improving' ? '\u2191' : trendDir === 'declining' ? '\u2193' : '\u2192';
  const trendCls = trendDir === 'improving' ? 'trend-up' : trendDir === 'declining' ? 'trend-down' : 'trend-same';

  // Reuse the same CSS from the compliance report
  const css = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #f8f9fb; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; padding: 40px 24px; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 48px 40px; border-radius: 12px; margin-bottom: 32px; }
    .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .header .subtitle { font-size: 14px; opacity: 0.8; }
    .meta { display: flex; gap: 32px; margin-top: 20px; flex-wrap: wrap; }
    .meta-item { font-size: 13px; opacity: 0.9; }
    .meta-item strong { display: block; font-size: 22px; opacity: 1; margin-top: 2px; }
    .section { background: white; border-radius: 10px; padding: 28px 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border: 1px solid #e5e7eb; }
    .section h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #1a1a2e; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
    .section h3 { font-size: 15px; font-weight: 600; margin-bottom: 10px; color: #374151; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 10px 12px; background: #f3f4f6; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }
    tr:hover td { background: #f9fafb; }
    .score-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 600; font-size: 13px; color: white; }
    .trend-arrow { font-size: 16px; font-weight: 700; }
    .trend-up { color: #16a34a; }
    .trend-down { color: #dc2626; }
    .trend-same { color: #6b7280; }
    .severity-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; text-transform: uppercase; color: white; }
    .sev-critical { background: #dc2626; }
    .sev-high { background: #ea580c; }
    .sev-medium { background: #d97706; }
    .sev-low { background: #2563eb; }
    .sev-info { background: #6b7280; }
    .risk-summary-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .risk-summary-item:last-child { border-bottom: none; }
    .risk-count { font-size: 20px; font-weight: 700; min-width: 36px; }
    .risk-desc { font-size: 14px; color: #374151; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric-card { background: #f9fafb; border-radius: 8px; padding: 12px 16px; border: 1px solid #e5e7eb; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 18px; font-weight: 600; color: #1a1a2e; margin-top: 2px; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #9ca3af; }
    .mono { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 12px; color: #6b7280; }
    @media (max-width: 600px) { .container { padding: 16px; } .header { padding: 28px 20px; } .section { padding: 20px; } .meta { gap: 16px; } }
    @media print { body { background: white; } .container { padding: 0; } .header { break-inside: avoid; } .section { break-inside: avoid; box-shadow: none; } }
  `;

  const parts: string[] = [];

  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">');
  parts.push(`<title>VibeCheck Scan Report &mdash; ${esc(repo.name)}</title>`);
  parts.push(`<style>${css}</style></head><body>`);
  parts.push('<div class="container">');

  // Header
  parts.push('<div class="header">');
  parts.push(`<h1>VibeCheck Scan Report</h1>`);
  parts.push(`<div class="subtitle">${esc(repo.name)} &mdash; ${esc(now)}</div>`);
  parts.push('<div class="meta">');
  parts.push(`<div class="meta-item">Overall Score<strong>${scan.overallScore ?? 'N/A'}<span style="font-size:14px;opacity:0.6">/100</span></strong></div>`);
  parts.push(`<div class="meta-item">Trend<strong class="${trendCls}">${trendEmoji} ${esc(trendLabel(trendDir))}</strong></div>`);
  parts.push(`<div class="meta-item">Modules<strong>${modules.length}</strong></div>`);
  parts.push(`<div class="meta-item">Findings<strong>${allFindings.length}</strong></div>`);
  if (scan.durationMs) {
    parts.push(`<div class="meta-item">Duration<strong>${formatDuration(scan.durationMs)}</strong></div>`);
  }
  parts.push('</div></div>');

  // Module Scores
  if (modules.length > 0) {
    parts.push('<div class="section">');
    parts.push('<h2>Module Scores</h2>');
    parts.push('<table><thead><tr><th>Module</th><th>Score</th><th>Trend</th><th>Confidence</th><th>Findings</th><th>Summary</th></tr></thead><tbody>');

    for (const mod of modules) {
      const prevMod = previousScan?.modules.find((m) => m.moduleId === mod.moduleId);
      const modArrow = prevMod ? trendArrow(mod.score, prevMod.score) : '\u2192';
      const arrowCls =
        modArrow === '\u2191' ? 'trend-up' : modArrow === '\u2193' ? 'trend-down' : 'trend-same';
      const conf = `${Math.round(mod.confidence * 100)}%`;
      const summary = mod.summary ? esc(mod.summary.substring(0, 100)) : '&mdash;';
      const sc = scoreColor(mod.score);

      parts.push('<tr>');
      parts.push(`<td><strong>${esc(mod.moduleId)}</strong></td>`);
      parts.push(`<td><span class="score-badge" style="background:${sc}">${mod.score}</span></td>`);
      parts.push(`<td><span class="trend-arrow ${arrowCls}">${modArrow}</span></td>`);
      parts.push(`<td>${conf}</td>`);
      parts.push(`<td>${mod.findings.length}</td>`);
      parts.push(`<td>${summary}</td>`);
      parts.push('</tr>');
    }

    parts.push('</tbody></table></div>');
  }

  // Metrics Summary
  const metricsModules = modules.filter((m) => m.metrics);
  if (metricsModules.length > 0) {
    parts.push('<div class="section">');
    parts.push('<h2>Metrics Summary</h2>');

    for (const mod of metricsModules) {
      let parsed: Record<string, number> = {};
      try {
        parsed = JSON.parse(mod.metrics!);
      } catch {
        continue;
      }
      const entries = Object.entries(parsed);
      if (entries.length === 0) continue;

      parts.push(`<h3>${esc(mod.moduleId)}</h3>`);
      parts.push('<div class="metrics-grid">');
      for (const [key, value] of entries) {
        const label = key
          .replace(/([A-Z])/g, ' $1')
          .replace(/[_-]/g, ' ')
          .replace(/^\w/, (c) => c.toUpperCase())
          .trim();
        parts.push('<div class="metric-card">');
        parts.push(`<div class="metric-label">${esc(label)}</div>`);
        parts.push(`<div class="metric-value">${typeof value === 'number' ? value.toLocaleString() : esc(String(value))}</div>`);
        parts.push('</div>');
      }
      parts.push('</div>');
    }

    parts.push('</div>');
  }

  // Top Findings
  const topFindings = sortedFindings.slice(0, 20);
  if (topFindings.length > 0) {
    parts.push('<div class="section">');
    parts.push('<h2>Top Findings</h2>');
    parts.push('<table><thead><tr><th>#</th><th>Severity</th><th>Category</th><th>Message</th><th>Location</th></tr></thead><tbody>');

    topFindings.forEach((f, i) => {
      const sevCls = `sev-${f.severity.toLowerCase()}`;
      const loc = f.filePath
        ? `<span class="mono">${esc(f.filePath)}${f.line ? `:${f.line}` : ''}</span>`
        : '&mdash;';
      const msg = esc(f.message.substring(0, 120));

      parts.push('<tr>');
      parts.push(`<td>${i + 1}</td>`);
      parts.push(`<td><span class="severity-badge ${sevCls}">${esc(f.severity)}</span></td>`);
      parts.push(`<td>${esc(f.category)}</td>`);
      parts.push(`<td>${msg}</td>`);
      parts.push(`<td>${loc}</td>`);
      parts.push('</tr>');
    });

    parts.push('</tbody></table>');
    if (sortedFindings.length > 20) {
      parts.push(`<p style="margin-top:12px;font-size:13px;color:#6b7280">... and ${sortedFindings.length - 20} more findings</p>`);
    }
    parts.push('</div>');
  }

  // Severity Breakdown
  const severityCounts: Record<string, number> = {};
  for (const f of allFindings) {
    const key = f.severity.toLowerCase();
    severityCounts[key] = (severityCounts[key] || 0) + 1;
  }
  const hasCounts = Object.values(severityCounts).some((c) => c > 0);

  if (hasCounts) {
    parts.push('<div class="section">');
    parts.push('<h2>Severity Breakdown</h2>');

    for (const sev of severityOrder) {
      const count = severityCounts[sev] || 0;
      if (count > 0) {
        const risk = mapToBusinessRisk(sev);
        parts.push('<div class="risk-summary-item">');
        parts.push(`<span class="risk-count" style="color:${risk.color}">${count}</span>`);
        parts.push(`<span class="risk-desc">${esc(risk.urgency)} &mdash; ${esc(risk.label)}</span>`);
        parts.push('</div>');
      }
    }

    parts.push('</div>');
  }

  // Footer
  parts.push('<div class="footer">Report generated by VibeCheck &mdash; Repository Health Scanner</div>');
  parts.push('</div></body></html>');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Scan Report — Standalone HTML (self-contained with embedded SVG charts)
// ---------------------------------------------------------------------------

function generateScanHtmlStandalone(scanId: string): string {
  const { repo, scan, modules, previousScan } = loadScanReportData(scanId);

  const allFindings = modules.flatMap((m) => m.findings);
  const severityOrder = getSeverityLevels();
  const sortedFindings = [...allFindings].sort((a, b) => {
    const aIdx = severityOrder.indexOf(a.severity.toLowerCase());
    const bIdx = severityOrder.indexOf(b.severity.toLowerCase());
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const prevScore = previousScan?.scan.overallScore ?? null;
  const trendDir: 'improving' | 'declining' | 'stable' =
    scan.overallScore !== null && prevScore !== null
      ? scan.overallScore > prevScore
        ? 'improving'
        : scan.overallScore < prevScore
          ? 'declining'
          : 'stable'
      : 'stable';

  // --- Generate SVG charts ---

  const scoreGaugeSvg = generateScoreGauge(scan.overallScore ?? 0, 180);

  const moduleEntries = modules.map((m) => ({
    moduleId: m.moduleId,
    score: m.score,
  }));
  const moduleBarChartSvg = generateModuleBarChart(moduleEntries, 580);

  // Severity counts for stacked bar
  const severityCounts: Record<string, number> = {};
  for (const f of allFindings) {
    const key = f.severity.toLowerCase();
    severityCounts[key] = (severityCounts[key] || 0) + 1;
  }

  const severityColorMap: Record<string, string> = {
    critical: '#dc2626',
    high: '#ea580c',
    medium: '#d97706',
    low: '#2563eb',
    info: '#6b7280',
  };

  const severityData = severityOrder
    .filter((sev) => (severityCounts[sev] || 0) > 0)
    .map((sev) => ({
      severity: sev,
      count: severityCounts[sev] || 0,
      color: severityColorMap[sev] || '#6b7280',
    }));

  const severityBarSvg = generateSeverityBar(severityData, 580);

  // --- Build module table HTML ---

  const moduleRows: string[] = [];
  for (const mod of modules) {
    const prevMod = previousScan?.modules.find((m) => m.moduleId === mod.moduleId);
    const modArrow = prevMod ? trendArrow(mod.score, prevMod.score) : '\u2192';
    const arrowCls =
      modArrow === '\u2191' ? 'trend-up' : modArrow === '\u2193' ? 'trend-down' : 'trend-same';
    const conf = `${Math.round(mod.confidence * 100)}%`;
    const summary = mod.summary ? esc(mod.summary.substring(0, 100)) : '&mdash;';
    const sc = scoreColor(mod.score);

    moduleRows.push('<tr>');
    moduleRows.push(`<td><strong>${esc(mod.moduleId)}</strong></td>`);
    moduleRows.push(`<td><span class="score-badge" style="background:${sc}">${mod.score}</span></td>`);
    moduleRows.push(`<td><span class="trend-arrow ${arrowCls}">${modArrow}</span></td>`);
    moduleRows.push(`<td>${conf}</td>`);
    moduleRows.push(`<td>${mod.findings.length}</td>`);
    moduleRows.push(`<td>${summary}</td>`);
    moduleRows.push('</tr>');
  }

  // --- Build metrics HTML ---

  const metricsModules = modules.filter((m) => m.metrics);
  const metricsParts: string[] = [];
  for (const mod of metricsModules) {
    let parsed: Record<string, number> = {};
    try {
      parsed = JSON.parse(mod.metrics!);
    } catch {
      continue;
    }
    const entries = Object.entries(parsed);
    if (entries.length === 0) continue;

    metricsParts.push(`<h3>${esc(mod.moduleId)}</h3>`);
    metricsParts.push('<div class="metrics-grid">');
    for (const [key, value] of entries) {
      const label = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase())
        .trim();
      metricsParts.push('<div class="metric-card">');
      metricsParts.push(`<div class="metric-label">${esc(label)}</div>`);
      metricsParts.push(`<div class="metric-value">${typeof value === 'number' ? value.toLocaleString() : esc(String(value))}</div>`);
      metricsParts.push('</div>');
    }
    metricsParts.push('</div>');
  }

  // --- Build findings table HTML ---

  const topFindings = sortedFindings.slice(0, 20);
  const findingsRows: string[] = [];
  topFindings.forEach((f, i) => {
    const sevCls = `sev-${f.severity.toLowerCase()}`;
    const loc = f.filePath
      ? `<span class="mono">${esc(f.filePath)}${f.line ? `:${f.line}` : ''}</span>`
      : '&mdash;';
    const msg = esc(f.message.substring(0, 120));

    findingsRows.push('<tr>');
    findingsRows.push(`<td>${i + 1}</td>`);
    findingsRows.push(`<td><span class="severity-badge ${sevCls}">${esc(f.severity)}</span></td>`);
    findingsRows.push(`<td>${esc(f.category)}</td>`);
    findingsRows.push(`<td>${msg}</td>`);
    findingsRows.push(`<td>${loc}</td>`);
    findingsRows.push('</tr>');
  });

  // --- Build severity list HTML ---

  const hasCounts = Object.values(severityCounts).some((c) => c > 0);
  const severityListParts: string[] = [];
  if (hasCounts) {
    for (const sev of severityOrder) {
      const count = severityCounts[sev] || 0;
      if (count > 0) {
        const risk = mapToBusinessRisk(sev);
        severityListParts.push('<div class="risk-summary-item">');
        severityListParts.push(`<span class="risk-count" style="color:${risk.color}">${count}</span>`);
        severityListParts.push(`<span class="risk-desc">${esc(risk.urgency)} &mdash; ${esc(risk.label)}</span>`);
        severityListParts.push('</div>');
      }
    }
  }

  // --- Assemble template data ---

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
    moduleTableHtml: moduleRows.join('\n'),
    metricsHtml: metricsParts.join('\n'),
    findingsTableHtml: findingsRows.join('\n'),
    extraFindingsCount: Math.max(0, sortedFindings.length - 20),
    severityListHtml: severityListParts.join('\n'),
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
