/**
 * Self-contained HTML template for standalone scan reports.
 *
 * All CSS is inlined — no external stylesheets or scripts required.
 * The resulting file opens in any browser without a server.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StandaloneReportData {
  repoName: string;
  scanId: string;
  scanDate: string;
  generatedDate: string;
  overallScore: number | null;
  previousScore: number | null;
  trend: 'improving' | 'declining' | 'stable';
  durationMs: number | null;
  moduleCount: number;
  findingsCount: number;

  /** Pre-rendered SVG string for the score gauge */
  scoreGaugeSvg: string;
  /** Pre-rendered SVG string for the module bar chart */
  moduleBarChartSvg: string;
  /** Pre-rendered SVG string for the severity stacked bar */
  severityBarSvg: string;

  /** Module scores table rows as pre-escaped HTML */
  moduleTableHtml: string;
  /** Metrics summary section as pre-escaped HTML */
  metricsHtml: string;
  /** Top findings table rows as pre-escaped HTML */
  findingsTableHtml: string;
  /** Extra findings count (shown as "... and N more") */
  extraFindingsCount: number;
  /** Severity breakdown list items as pre-escaped HTML */
  severityListHtml: string;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;background:#f8f9fb;line-height:1.6;-webkit-font-smoothing:antialiased}
.container{max-width:920px;margin:0 auto;padding:40px 24px}
.header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);color:#fff;padding:48px 40px;border-radius:12px;margin-bottom:32px}
.header h1{font-size:26px;font-weight:700;margin-bottom:2px;letter-spacing:-0.3px}
.header .subtitle{font-size:14px;opacity:.78}
.meta{display:flex;gap:32px;margin-top:20px;flex-wrap:wrap}
.meta-item{font-size:13px;opacity:.88}
.meta-item strong{display:block;font-size:22px;opacity:1;margin-top:2px}
.score-section{display:flex;align-items:center;gap:32px;flex-wrap:wrap}
.score-gauge{flex-shrink:0}
.score-details{flex:1;min-width:200px}
.section{background:#fff;border-radius:10px;padding:28px 32px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid #e5e7eb}
.section h2{font-size:17px;font-weight:600;margin-bottom:16px;color:#1a1a2e;border-bottom:2px solid #e5e7eb;padding-bottom:8px}
.section h3{font-size:14px;font-weight:600;margin-bottom:10px;color:#374151}
.chart-container{margin:16px 0;text-align:center;overflow-x:auto}
.chart-container svg{max-width:100%;height:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 12px;background:#f3f4f6;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;border-bottom:2px solid #e5e7eb}
td{padding:10px 12px;border-bottom:1px solid #f3f4f6}
tr:hover td{background:#f9fafb}
.score-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600;font-size:13px;color:#fff}
.trend-up{color:#16a34a}
.trend-down{color:#dc2626}
.trend-same{color:#6b7280}
.trend-arrow{font-size:15px;font-weight:700}
.severity-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600;font-size:11px;text-transform:uppercase;color:#fff}
.sev-critical{background:#dc2626}
.sev-high{background:#ea580c}
.sev-medium{background:#d97706}
.sev-low{background:#2563eb}
.sev-info{background:#6b7280}
.risk-summary-item{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6}
.risk-summary-item:last-child{border-bottom:none}
.risk-count{font-size:20px;font-weight:700;min-width:36px}
.risk-desc{font-size:14px;color:#374151}
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}
.metric-card{background:#f9fafb;border-radius:8px;padding:12px 16px;border:1px solid #e5e7eb}
.metric-label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px}
.metric-value{font-size:17px;font-weight:600;color:#1a1a2e;margin-top:2px}
.mono{font-family:'SF Mono',Monaco,'Cascadia Code',Consolas,monospace;font-size:12px;color:#6b7280}
.footer{text-align:center;padding:24px;font-size:12px;color:#9ca3af}
.extra-note{margin-top:12px;font-size:13px;color:#6b7280}
@media(max-width:640px){.container{padding:16px}.header{padding:28px 20px}.section{padding:20px}.meta{gap:16px}.score-section{flex-direction:column;align-items:flex-start}}
@media print{body{background:#fff}.container{padding:0}.header{break-inside:avoid}.section{break-inside:avoid;box-shadow:none}}
`;

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null): string {
  if (ms === null) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function trendLabel(trend: 'improving' | 'declining' | 'stable'): string {
  switch (trend) {
    case 'improving': return 'Improving';
    case 'declining': return 'Declining';
    case 'stable': return 'Stable';
  }
}

function trendSymbol(trend: 'improving' | 'declining' | 'stable'): string {
  switch (trend) {
    case 'improving': return '\u2191';
    case 'declining': return '\u2193';
    case 'stable': return '\u2192';
  }
}

function trendClass(trend: 'improving' | 'declining' | 'stable'): string {
  switch (trend) {
    case 'improving': return 'trend-up';
    case 'declining': return 'trend-down';
    case 'stable': return 'trend-same';
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders a fully self-contained HTML document from the given report data.
 *
 * The output has no external dependencies — all CSS is inlined and all
 * charts are embedded as inline SVG.
 */
export function renderStandaloneHtml(data: StandaloneReportData): string {
  const p: string[] = [];

  // Document head
  p.push('<!DOCTYPE html>');
  p.push(`<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">`);
  p.push(`<title>VibeCheck Scan Report &mdash; ${esc(data.repoName)}</title>`);
  p.push(`<style>${CSS}</style></head><body>`);
  p.push('<div class="container">');

  // Header
  const tc = trendClass(data.trend);
  const ts = trendSymbol(data.trend);
  const tl = trendLabel(data.trend);

  p.push('<div class="header">');
  p.push(`<h1>VibeCheck Scan Report</h1>`);
  p.push(`<div class="subtitle">${esc(data.repoName)} &mdash; ${esc(data.generatedDate)}</div>`);
  p.push('<div class="meta">');
  p.push(`<div class="meta-item">Overall Score<strong>${data.overallScore ?? 'N/A'}<span style="font-size:14px;opacity:.6">/100</span></strong></div>`);
  p.push(`<div class="meta-item">Trend<strong class="${tc}">${ts} ${esc(tl)}</strong></div>`);
  p.push(`<div class="meta-item">Modules<strong>${data.moduleCount}</strong></div>`);
  p.push(`<div class="meta-item">Findings<strong>${data.findingsCount}</strong></div>`);
  if (data.durationMs !== null) {
    p.push(`<div class="meta-item">Duration<strong>${formatDuration(data.durationMs)}</strong></div>`);
  }
  p.push('</div></div>');

  // Score Overview with gauge
  p.push('<div class="section">');
  p.push('<h2>Score Overview</h2>');
  p.push('<div class="score-section">');
  p.push(`<div class="score-gauge">${data.scoreGaugeSvg}</div>`);
  p.push('<div class="score-details">');
  if (data.previousScore !== null) {
    p.push(`<p style="font-size:14px;color:#374151;margin-bottom:8px">Previous score: <strong>${data.previousScore}</strong>/100</p>`);
  }
  p.push(`<p style="font-size:14px;color:#374151">Scan ID: <span class="mono">${esc(data.scanId)}</span></p>`);
  p.push(`<p style="font-size:14px;color:#374151">Scanned: ${esc(data.scanDate)}</p>`);
  p.push('</div></div></div>');

  // Module Scores with bar chart
  if (data.moduleTableHtml) {
    p.push('<div class="section">');
    p.push('<h2>Module Scores</h2>');
    p.push('<div class="chart-container">');
    p.push(data.moduleBarChartSvg);
    p.push('</div>');
    p.push('<table><thead><tr><th>Module</th><th>Score</th><th>Trend</th><th>Confidence</th><th>Findings</th><th>Summary</th></tr></thead><tbody>');
    p.push(data.moduleTableHtml);
    p.push('</tbody></table></div>');
  }

  // Metrics Summary
  if (data.metricsHtml) {
    p.push('<div class="section">');
    p.push('<h2>Metrics Summary</h2>');
    p.push(data.metricsHtml);
    p.push('</div>');
  }

  // Severity Breakdown with stacked bar
  if (data.severityListHtml) {
    p.push('<div class="section">');
    p.push('<h2>Severity Breakdown</h2>');
    p.push('<div class="chart-container">');
    p.push(data.severityBarSvg);
    p.push('</div>');
    p.push(data.severityListHtml);
    p.push('</div>');
  }

  // Top Findings
  if (data.findingsTableHtml) {
    p.push('<div class="section">');
    p.push('<h2>Top Findings</h2>');
    p.push('<table><thead><tr><th>#</th><th>Severity</th><th>Category</th><th>Message</th><th>Location</th></tr></thead><tbody>');
    p.push(data.findingsTableHtml);
    p.push('</tbody></table>');
    if (data.extraFindingsCount > 0) {
      p.push(`<p class="extra-note">&hellip; and ${data.extraFindingsCount} more findings</p>`);
    }
    p.push('</div>');
  }

  // Footer
  p.push('<div class="footer">Report generated by VibeCheck &mdash; Repository Health Scanner<br>');
  p.push(`<span class="mono">Scan ${esc(data.scanId)}</span> &middot; Self-contained HTML report</div>`);
  p.push('</div></body></html>');

  return p.join('\n');
}
