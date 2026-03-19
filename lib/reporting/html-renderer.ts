/**
 * HTML fragment builders for report generation.
 *
 * These helpers produce reusable HTML fragments (module tables, finding rows,
 * severity breakdowns, metrics grids) consumed by the main generator and
 * the standalone template.
 */

import { mapToBusinessRisk, getSeverityLevels } from './risk-mapping';
import {
  escapeHtml,
  trendArrow,
  scoreColor,
  arrowCssClass,
  formatDuration,
  shortDate,
  trendLabel,
  trendEmoji,
  trendCssClass,
  formatMetricLabel,
  parseMetrics,
  countSeverities,
  sortFindingsBySeverity,
  type FindingRow,
  type ModuleWithFindings,
  type ScanWithModules,
} from './shared';

// ---------------------------------------------------------------------------
// CSS — shared between generateHtml and generateScanHtml
// ---------------------------------------------------------------------------

export const REPORT_CSS = `
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
    .risk-item { padding: 10px 14px; border-left: 4px solid; margin-bottom: 8px; border-radius: 0 6px 6px 0; background: #f9fafb; }
    .risk-item .risk-label { font-weight: 600; font-size: 13px; }
    .risk-item .risk-message { font-size: 14px; color: #374151; margin-top: 2px; }
    .risk-item .risk-file { font-size: 12px; color: #6b7280; font-family: monospace; margin-top: 2px; }
    .risk-summary-item { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .risk-summary-item:last-child { border-bottom: none; }
    .risk-count { font-size: 20px; font-weight: 700; min-width: 36px; }
    .risk-desc { font-size: 14px; color: #374151; }
    .summary-text { font-size: 15px; color: #374151; margin-bottom: 16px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .metric-card { background: #f9fafb; border-radius: 8px; padding: 12px 16px; border: 1px solid #e5e7eb; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 18px; font-weight: 600; color: #1a1a2e; margin-top: 2px; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #9ca3af; }
    .mono { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 12px; color: #6b7280; }
    @media (max-width: 600px) { .container { padding: 16px; } .header { padding: 28px 20px; } .section { padding: 20px; } .meta { gap: 16px; } }
    @media print { body { background: white; } .container { padding: 0; } .header { break-inside: avoid; } .section { break-inside: avoid; box-shadow: none; } }
`;

// ---------------------------------------------------------------------------
// HTML document wrapper
// ---------------------------------------------------------------------------

export function htmlDocOpen(title: string, css: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${title}</title>`,
    `<style>${css}</style></head><body>`,
    '<div class="container">',
  ].join('\n');
}

export function htmlDocClose(): string {
  return [
    '<div class="footer">Report generated by VibeCheck &mdash; Repository Health Scanner</div>',
    '</div></body></html>',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface HeaderMeta {
  label: string;
  value: string;
  cssClass?: string;
}

export function renderHtmlHeader(
  title: string,
  subtitle: string,
  metaItems: HeaderMeta[],
): string {
  const parts: string[] = [];
  parts.push('<div class="header">');
  parts.push(`<h1>${title}</h1>`);
  parts.push(`<div class="subtitle">${subtitle}</div>`);
  parts.push('<div class="meta">');
  for (const item of metaItems) {
    const cls = item.cssClass ? ` class="${item.cssClass}"` : '';
    parts.push(`<div class="meta-item">${escapeHtml(item.label)}<strong${cls}>${item.value}</strong></div>`);
  }
  parts.push('</div></div>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Top risks (used in compliance reports)
// ---------------------------------------------------------------------------

export function renderHtmlTopRisks(risks: FindingRow[]): string {
  if (risks.length === 0) return '';
  const parts: string[] = [];
  parts.push('<h3>Top Risks</h3>');
  for (const f of risks) {
    const risk = mapToBusinessRisk(f.severity);
    parts.push(`<div class="risk-item" style="border-left-color: ${risk.color}">`);
    parts.push(`<div class="risk-label" style="color: ${risk.color}">${escapeHtml(risk.label)}</div>`);
    parts.push(`<div class="risk-message">${escapeHtml(f.message)}</div>`);
    if (f.filePath) {
      parts.push(`<div class="risk-file">${escapeHtml(f.filePath)}${f.line ? `:${f.line}` : ''}</div>`);
    }
    parts.push('</div>');
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Module scores table
// ---------------------------------------------------------------------------

export interface ModuleRowOptions {
  showFindings?: boolean;
}

export function renderHtmlModuleRows(
  modules: ModuleWithFindings[],
  previousModules: ModuleWithFindings[] | null,
  options: ModuleRowOptions = {},
): string {
  const rows: string[] = [];
  for (const mod of modules) {
    const prevMod = previousModules?.find((m) => m.moduleId === mod.moduleId);
    const modArrow = prevMod ? trendArrow(mod.score, prevMod.score) : '\u2192';
    const cls = arrowCssClass(modArrow);
    const conf = `${Math.round(mod.confidence * 100)}%`;
    const summary = mod.summary ? escapeHtml(mod.summary.substring(0, 100)) : '&mdash;';
    const sc = scoreColor(mod.score);

    rows.push('<tr>');
    rows.push(`<td><strong>${escapeHtml(mod.moduleId)}</strong></td>`);
    rows.push(`<td><span class="score-badge" style="background:${sc}">${mod.score}</span></td>`);
    rows.push(`<td><span class="trend-arrow ${cls}">${modArrow}</span></td>`);
    rows.push(`<td>${conf}</td>`);
    if (options.showFindings) {
      rows.push(`<td>${mod.findings.length}</td>`);
    }
    rows.push(`<td>${summary}</td>`);
    rows.push('</tr>');
  }
  return rows.join('\n');
}

export function renderHtmlModuleTable(
  modules: ModuleWithFindings[],
  previousModules: ModuleWithFindings[] | null,
  options: ModuleRowOptions = {},
): string {
  const parts: string[] = [];
  parts.push('<div class="section">');
  parts.push('<h2>Module Scores</h2>');
  const findingsHeader = options.showFindings ? '<th>Findings</th>' : '';
  parts.push(`<table><thead><tr><th>Module</th><th>Score</th><th>Trend</th><th>Confidence</th>${findingsHeader}<th>Summary</th></tr></thead><tbody>`);
  parts.push(renderHtmlModuleRows(modules, previousModules, options));
  parts.push('</tbody></table></div>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Findings table
// ---------------------------------------------------------------------------

export function renderHtmlFindingsRows(findingsList: FindingRow[], maxCount: number = 20): string {
  const top = findingsList.slice(0, maxCount);
  const rows: string[] = [];
  top.forEach((f, i) => {
    const sevCls = `sev-${f.severity.toLowerCase()}`;
    const loc = f.filePath
      ? `<span class="mono">${escapeHtml(f.filePath)}${f.line ? `:${f.line}` : ''}</span>`
      : '&mdash;';
    const msg = escapeHtml(f.message.substring(0, 120));

    rows.push('<tr>');
    rows.push(`<td>${i + 1}</td>`);
    rows.push(`<td><span class="severity-badge ${sevCls}">${escapeHtml(f.severity)}</span></td>`);
    rows.push(`<td>${escapeHtml(f.category)}</td>`);
    rows.push(`<td>${msg}</td>`);
    rows.push(`<td>${loc}</td>`);
    rows.push('</tr>');
  });
  return rows.join('\n');
}

export function renderHtmlFindingsTable(
  sortedFindings: FindingRow[],
  maxCount: number = 20,
): string {
  const top = sortedFindings.slice(0, maxCount);
  if (top.length === 0) return '';

  const parts: string[] = [];
  parts.push('<div class="section">');
  parts.push('<h2>Top Findings</h2>');
  parts.push('<table><thead><tr><th>#</th><th>Severity</th><th>Category</th><th>Message</th><th>Location</th></tr></thead><tbody>');
  parts.push(renderHtmlFindingsRows(sortedFindings, maxCount));
  parts.push('</tbody></table>');
  if (sortedFindings.length > maxCount) {
    parts.push(`<p style="margin-top:12px;font-size:13px;color:#6b7280">... and ${sortedFindings.length - maxCount} more findings</p>`);
  }
  parts.push('</div>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Severity breakdown
// ---------------------------------------------------------------------------

/**
 * Render just the severity list items (no section wrapper).
 * Used by the standalone template which adds its own wrapper.
 */
export function renderHtmlSeverityListItems(
  severityCounts: Record<string, number>,
  options: { showUrgency?: boolean } = {},
): string {
  const hasCounts = Object.values(severityCounts).some((c) => c > 0);
  if (!hasCounts) return '';

  const parts: string[] = [];
  for (const sev of getSeverityLevels()) {
    const count = severityCounts[sev] || 0;
    if (count > 0) {
      const risk = mapToBusinessRisk(sev);
      parts.push('<div class="risk-summary-item">');
      parts.push(`<span class="risk-count" style="color:${risk.color}">${count}</span>`);
      if (options.showUrgency) {
        parts.push(`<span class="risk-desc">${escapeHtml(risk.urgency)} &mdash; ${escapeHtml(risk.label)}</span>`);
      } else {
        parts.push(`<span class="risk-desc">${escapeHtml(risk.label)}</span>`);
      }
      parts.push('</div>');
    }
  }
  return parts.join('\n');
}

/**
 * Render a full severity breakdown section with wrapper.
 */
export function renderHtmlSeverityBreakdown(
  severityCounts: Record<string, number>,
  options: { showUrgency?: boolean; title?: string } = {},
): string {
  const inner = renderHtmlSeverityListItems(severityCounts, options);
  if (!inner) return '';

  const title = options.title ?? 'Risk Assessment Summary';
  return [`<div class="section">`, `<h2>${title}</h2>`, inner, `</div>`].join('\n');
}

// ---------------------------------------------------------------------------
// Metrics grid
// ---------------------------------------------------------------------------

/**
 * Render just the metrics cards (no section wrapper).
 * Used by the standalone template which adds its own wrapper.
 */
export function renderHtmlMetricsInner(modules: ModuleWithFindings[]): string {
  const metricsModules = modules.filter((m) => m.metrics);
  if (metricsModules.length === 0) return '';

  const parts: string[] = [];
  let hasContent = false;

  for (const mod of metricsModules) {
    const entries = parseMetrics(mod.metrics);
    if (entries.length === 0) continue;
    hasContent = true;

    parts.push(`<h3>${escapeHtml(mod.moduleId)}</h3>`);
    parts.push('<div class="metrics-grid">');
    for (const [key, value] of entries) {
      const label = formatMetricLabel(key);
      parts.push('<div class="metric-card">');
      parts.push(`<div class="metric-label">${escapeHtml(label)}</div>`);
      parts.push(`<div class="metric-value">${typeof value === 'number' ? value.toLocaleString() : escapeHtml(String(value))}</div>`);
      parts.push('</div>');
    }
    parts.push('</div>');
  }

  if (!hasContent) return '';
  return parts.join('\n');
}

/**
 * Render a full metrics summary section with wrapper.
 */
export function renderHtmlMetricsSection(modules: ModuleWithFindings[]): string {
  const inner = renderHtmlMetricsInner(modules);
  if (!inner) return '';
  return ['<div class="section">', '<h2>Metrics Summary</h2>', inner, '</div>'].join('\n');
}

// ---------------------------------------------------------------------------
// Scan history table (compliance reports)
// ---------------------------------------------------------------------------

export function renderHtmlScanHistory(scanDetails: ScanWithModules[]): string {
  if (scanDetails.length <= 1) return '';

  const parts: string[] = [];
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
    parts.push(`<td>${escapeHtml(shortDate(sd.scan.createdAt))}</td>`);
    parts.push(`<td>${scHtml}</td>`);
    parts.push(`<td>${formatDuration(sd.scan.durationMs)}</td>`);
    parts.push(`<td>${sd.modules.length}</td>`);
    parts.push('</tr>');
  }

  parts.push('</tbody></table></div>');
  return parts.join('\n');
}
