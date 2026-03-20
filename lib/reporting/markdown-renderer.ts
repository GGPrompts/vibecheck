/**
 * Markdown fragment builders for report generation.
 *
 * Produces reusable Markdown sections (module tables, finding tables,
 * severity breakdowns, metrics summaries) consumed by the main generator.
 */

import { mapToBusinessRisk, getSeverityLevels } from './risk-mapping';
import {
  trendArrow,
  formatMetricLabel,
  parseMetrics,
  type FindingRow,
  type ModuleWithFindings,
} from './shared';

// ---------------------------------------------------------------------------
// Module scores table
// ---------------------------------------------------------------------------

interface MdModuleTableOptions {
  showFindings?: boolean;
}

export function renderMdModuleTable(
  modules: ModuleWithFindings[],
  previousModules: ModuleWithFindings[] | null,
  options: MdModuleTableOptions = {},
): string {
  const lines: string[] = [];
  lines.push('## Module Scores');
  lines.push('');

  if (options.showFindings) {
    lines.push('| Module | Score | Confidence | Findings | Summary |');
    lines.push('|--------|-------|------------|----------|---------|');
  } else {
    lines.push('| Module | Score | Trend | Confidence | Summary |');
    lines.push('|--------|-------|-------|------------|---------|');
  }

  for (const mod of modules) {
    const prevMod = previousModules?.find((m) => m.moduleId === mod.moduleId);
    const arrow = prevMod ? trendArrow(mod.score, prevMod.score) : '\u2192';
    const conf = `${Math.round(mod.confidence * 100)}%`;
    const summary = mod.summary ? mod.summary.replace(/\|/g, '/').substring(0, 80) : '-';

    if (options.showFindings) {
      const modArrow = prevMod ? ` ${arrow}` : '';
      lines.push(
        `| ${mod.moduleId} | ${mod.score}/100${modArrow} | ${conf} | ${mod.findings.length} | ${summary} |`,
      );
    } else {
      lines.push(`| ${mod.moduleId} | ${mod.score}/100 | ${arrow} | ${conf} | ${summary} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Findings table
// ---------------------------------------------------------------------------

export function renderMdFindingsTable(
  sortedFindings: FindingRow[],
  maxCount: number = 20,
): string {
  const top = sortedFindings.slice(0, maxCount);
  if (top.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Top Findings');
  lines.push('');
  lines.push('| # | Severity | Category | Message | Location |');
  lines.push('|---|----------|----------|---------|----------|');

  top.forEach((f, i) => {
    const risk = mapToBusinessRisk(f.severity);
    const loc = f.filePath ? `\`${f.filePath}${f.line ? `:${f.line}` : ''}\`` : '-';
    const msg = f.message.replace(/\|/g, '/').substring(0, 100);
    lines.push(`| ${i + 1} | ${risk.urgency} | ${f.category} | ${msg} | ${loc} |`);
  });

  if (sortedFindings.length > maxCount) {
    lines.push('');
    lines.push(`*... and ${sortedFindings.length - maxCount} more findings*`);
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Severity breakdown
// ---------------------------------------------------------------------------

export function renderMdSeverityBreakdown(
  severityCounts: Record<string, number>,
  options: { title?: string; useUrgency?: boolean } = {},
): string {
  const hasCounts = Object.values(severityCounts).some((c) => c > 0);
  if (!hasCounts) return '';

  const title = options.title ?? 'Risk Assessment Summary';
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push('');

  for (const sev of getSeverityLevels()) {
    const count = severityCounts[sev] || 0;
    if (count > 0) {
      const risk = mapToBusinessRisk(sev);
      const label = options.useUrgency ? risk.urgency : risk.label;
      lines.push(`- **${label}**: ${count} finding${count !== 1 ? 's' : ''}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Top risks (compliance reports)
// ---------------------------------------------------------------------------

export function renderMdTopRisks(risks: FindingRow[]): string {
  if (risks.length === 0) return '';

  const lines: string[] = [];
  lines.push('### Top Risks');
  lines.push('');
  risks.forEach((f, i) => {
    const risk = mapToBusinessRisk(f.severity);
    lines.push(`${i + 1}. **${risk.label}** \u2014 ${f.message}`);
    if (f.filePath) {
      lines.push(`   - File: \`${f.filePath}${f.line ? `:${f.line}` : ''}\``);
    }
  });
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Metrics summary
// ---------------------------------------------------------------------------

export function renderMdMetricsSection(modules: ModuleWithFindings[]): string {
  const metricsModules = modules.filter((m) => m.metrics);
  if (metricsModules.length === 0) return '';

  const lines: string[] = [];
  let hasContent = false;

  for (const mod of metricsModules) {
    const entries = parseMetrics(mod.metrics);
    if (entries.length === 0) continue;
    hasContent = true;

    lines.push(`### ${mod.moduleId}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    for (const [key, value] of entries) {
      const label = formatMetricLabel(key);
      lines.push(`| ${label} | ${typeof value === 'number' ? value.toLocaleString() : value} |`);
    }
    lines.push('');
  }

  if (!hasContent) return '';

  return ['## Metrics Summary', '', ...lines].join('\n');
}
