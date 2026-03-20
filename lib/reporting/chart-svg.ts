/**
 * Server-side SVG chart generation for standalone HTML reports.
 *
 * Produces pure SVG markup strings without any React or DOM dependency.
 * All charts are self-contained and render in any modern browser.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escSvg(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scoreColor(score: number): string {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  if (score >= 40) return '#ea580c';
  return '#dc2626';
}

// ---------------------------------------------------------------------------
// Score Gauge — circular arc showing 0-100
// ---------------------------------------------------------------------------

/**
 * Generates a circular gauge SVG showing a score from 0 to 100.
 *
 * The gauge is a 240-degree arc (from 150deg to 390deg) with a track
 * background and a colored foreground arc proportional to the score.
 */
export function generateScoreGauge(score: number, size = 200): string {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.38;
  const strokeWidth = size * 0.09;

  // Arc spans 240 degrees, starting at 150deg (7 o'clock) to 390deg (5 o'clock)
  const startAngle = 150;
  const totalArc = 240;
  const endAngle = startAngle + totalArc;

  const clampedScore = Math.max(0, Math.min(100, score));
  const scoreAngle = startAngle + (totalArc * clampedScore) / 100;

  function polarToCartesian(angle: number): { x: number; y: number } {
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function describeArc(start: number, end: number): string {
    const s = polarToCartesian(start);
    const e = polarToCartesian(end);
    const largeArcFlag = end - start > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${e.x} ${e.y}`;
  }

  const trackPath = describeArc(startAngle, endAngle);
  const scorePath = clampedScore > 0 ? describeArc(startAngle, scoreAngle) : '';
  const color = scoreColor(clampedScore);

  const labelY = cy + size * 0.05;
  const subLabelY = labelY + size * 0.1;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Score gauge: ${clampedScore} out of 100">
  <path d="${trackPath}" fill="none" stroke="#e5e7eb" stroke-width="${strokeWidth}" stroke-linecap="round"/>
  ${scorePath ? `<path d="${scorePath}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>` : ''}
  <text x="${cx}" y="${labelY}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${size * 0.22}" font-weight="700" fill="${color}">${clampedScore}</text>
  <text x="${cx}" y="${subLabelY}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="${size * 0.07}" fill="#6b7280">out of 100</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Module Scores Bar Chart
// ---------------------------------------------------------------------------

interface ModuleScoreEntry {
  moduleId: string;
  score: number;
}

/**
 * Generates a horizontal bar chart SVG showing module scores.
 *
 * Each module gets a labeled row with a proportional bar (0-100 scale).
 */
export function generateModuleBarChart(
  modules: ModuleScoreEntry[],
  width = 600,
): string {
  if (modules.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" width="${width}" height="40">
  <text x="${width / 2}" y="24" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#6b7280">No module data available</text>
</svg>`;
  }

  const barHeight = 28;
  const rowSpacing = 8;
  const labelWidth = 160;
  const scoreWidth = 44;
  const barAreaWidth = width - labelWidth - scoreWidth - 20;
  const rowHeight = barHeight + rowSpacing;
  const paddingTop = 8;
  const totalHeight = paddingTop + modules.length * rowHeight + 4;

  const rows = modules.map((mod, i) => {
    const y = paddingTop + i * rowHeight;
    const barW = Math.max(2, (mod.score / 100) * barAreaWidth);
    const color = scoreColor(mod.score);
    const truncatedId = mod.moduleId.length > 20
      ? mod.moduleId.substring(0, 18) + '...'
      : mod.moduleId;

    return `  <g>
    <text x="${labelWidth - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="#374151" font-weight="500">${escSvg(truncatedId)}</text>
    <rect x="${labelWidth}" y="${y}" width="${barAreaWidth}" height="${barHeight}" rx="4" fill="#f3f4f6"/>
    <rect x="${labelWidth}" y="${y}" width="${barW}" height="${barHeight}" rx="4" fill="${color}" opacity="0.85"/>
    <text x="${labelWidth + barAreaWidth + 8}" y="${y + barHeight / 2 + 4}" text-anchor="start" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" fill="${color}" font-weight="600">${mod.score}</text>
  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="${width}" height="${totalHeight}" role="img" aria-label="Module scores bar chart">
${rows.join('\n')}
</svg>`;
}

// ---------------------------------------------------------------------------
// Severity Breakdown — horizontal stacked bar
// ---------------------------------------------------------------------------

interface SeverityCount {
  severity: string;
  count: number;
  color: string;
}

/**
 * Generates a horizontal stacked bar SVG showing severity breakdown.
 *
 * Each severity level gets a proportional segment of the bar, with a
 * legend below.
 */
export function generateSeverityBar(
  severities: SeverityCount[],
  width = 600,
): string {
  const total = severities.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" width="${width}" height="40">
  <text x="${width / 2}" y="24" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" fill="#6b7280">No findings</text>
</svg>`;
  }

  const barHeight = 32;
  const barY = 8;
  const legendY = barY + barHeight + 24;
  const legendItemWidth = width / Math.max(severities.length, 1);
  const totalHeight = legendY + 20;
  const barRadius = 6;

  // Build stacked segments
  let xOffset = 0;
  const segments = severities
    .filter((s) => s.count > 0)
    .map((s, i, arr) => {
      const segWidth = (s.count / total) * width;
      const x = xOffset;
      xOffset += segWidth;

      // First and last segments get rounded corners
      let rx = '';
      if (arr.length === 1) {
        rx = ` rx="${barRadius}"`;
      } else if (i === 0) {
        // Use a clip-path approach for first segment
        return `<rect x="${x}" y="${barY}" width="${segWidth + barRadius}" height="${barHeight}" rx="${barRadius}" fill="${s.color}"/><rect x="${x + segWidth}" y="${barY}" width="${barRadius}" height="${barHeight}" fill="${s.color}"/>`;
      } else if (i === arr.length - 1) {
        return `<rect x="${x - barRadius}" y="${barY}" width="${barRadius}" height="${barHeight}" fill="${s.color}"/><rect x="${x}" y="${barY}" width="${segWidth}" height="${barHeight}" rx="${barRadius}" fill="${s.color}"/>`;
      }

      return `<rect x="${x}" y="${barY}" width="${segWidth}" height="${barHeight}"${rx} fill="${s.color}"/>`;
    });

  // Build legend
  const nonZero = severities.filter((s) => s.count > 0);
  const legendSpacing = Math.min(legendItemWidth, 140);
  const legendStartX = (width - nonZero.length * legendSpacing) / 2;
  const legendItems = nonZero.map((s, i) => {
    const lx = legendStartX + i * legendSpacing;
    const capitalLabel = s.severity.charAt(0).toUpperCase() + s.severity.slice(1);
    return `  <g>
    <rect x="${lx}" y="${legendY - 8}" width="12" height="12" rx="2" fill="${s.color}"/>
    <text x="${lx + 16}" y="${legendY + 2}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="#374151">${escSvg(capitalLabel)}: ${s.count}</text>
  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" width="${width}" height="${totalHeight}" role="img" aria-label="Severity breakdown: ${nonZero.map((s) => `${s.count} ${s.severity}`).join(', ')}">
  <g>
${segments.join('\n')}
  </g>
${legendItems.join('\n')}
</svg>`;
}
