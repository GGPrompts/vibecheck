import type { PrioritizedFinding } from './prioritizer';

interface PromptSection {
  filePath: string;
  summary: string;
  details: string[];
  actions: string[];
  context: string;
}

function severityLabel(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function locationString(f: PrioritizedFinding): string {
  if (f.line) return `${f.filePath}:${f.line}`;
  return f.filePath;
}

function contextLine(f: PrioritizedFinding): string {
  const parts: string[] = [`Severity: ${severityLabel(f.severity)}`];
  parts.push(`Module: ${f.moduleId}`);
  if (f.confidence < 1) {
    parts.push(`Confidence: ${Math.round(f.confidence * 100)}%`);
  }
  if (f.churnRate && f.churnRate > 0) {
    parts.push(`Change frequency: ${f.churnRate.toFixed(1)} commits/month`);
  }
  return parts.join(' | ');
}

export function complexityTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return '- Refactor by extracting helper functions, reducing nesting depth, and splitting conditional branches into named methods.';
  });

  return {
    filePath,
    summary: `High complexity detected in ${filePath}`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

export function securityTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return '- Run `npm audit fix` or manually upgrade the affected package to a patched version.';
  });

  return {
    filePath,
    summary: `Security issue in ${filePath}`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

export function dependencyTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return '- Update the most critical packages first. Run `npm outdated` to review, then `npm update` or manually bump versions.';
  });

  return {
    filePath,
    summary: `${findings.length} dependency issue${findings.length > 1 ? 's' : ''} found`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

export function gitHealthTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return '- Consider pairing on this file or scheduling a knowledge-sharing session to reduce bus factor risk.';
  });

  return {
    filePath,
    summary: `Git health concern in ${filePath}`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

export function genericTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return `- Review and address this ${f.severity} issue.`;
  });

  return {
    filePath,
    summary: `Issue${findings.length > 1 ? 's' : ''} detected in ${filePath}`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

const CATEGORY_TEMPLATES: Record<
  string,
  (findings: PrioritizedFinding[]) => PromptSection
> = {
  complexity: complexityTemplate,
  security: securityTemplate,
  dependency: dependencyTemplate,
  dependencies: dependencyTemplate,
  'git-health': gitHealthTemplate,
  'git_health': gitHealthTemplate,
  'bus-factor': gitHealthTemplate,
  'bus_factor': gitHealthTemplate,
};

/**
 * Select the appropriate template for a group of findings based on
 * the primary (most common) category in the group.
 */
export function selectTemplate(
  findings: PrioritizedFinding[]
): (findings: PrioritizedFinding[]) => PromptSection {
  // Count categories to find the dominant one
  const categoryCounts = new Map<string, number>();
  for (const f of findings) {
    categoryCounts.set(f.category, (categoryCounts.get(f.category) ?? 0) + 1);
  }
  let topCategory = findings[0].category;
  let topCount = 0;
  for (const [cat, count] of categoryCounts) {
    if (count > topCount) {
      topCategory = cat;
      topCount = count;
    }
  }

  return CATEGORY_TEMPLATES[topCategory] ?? genericTemplate;
}

/**
 * Format a PromptSection into a readable text block.
 */
export function formatSection(index: number, section: PromptSection): string {
  const lines: string[] = [];
  lines.push(`### ${index}. ${section.summary}`);
  lines.push(`File: ${section.filePath}`);
  lines.push('');
  lines.push('**What\'s wrong:**');
  for (const d of section.details) {
    lines.push(d);
  }
  lines.push('');
  lines.push('**Suggested action:**');
  for (const a of section.actions) {
    lines.push(a);
  }
  lines.push('');
  lines.push(`_${section.context}_`);
  return lines.join('\n');
}
