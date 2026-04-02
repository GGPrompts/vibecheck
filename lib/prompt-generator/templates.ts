import type { PrioritizedFinding } from './prioritizer';

export interface PromptSection {
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

function complexityTemplate(findings: PrioritizedFinding[]): PromptSection {
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

function securityTemplate(findings: PrioritizedFinding[]): PromptSection {
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

function dependencyTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${f.message}`);
  const actions: string[] = [];

  const vulns = findings.filter((f) => f.message.toLowerCase().includes('vulnerability') || f.message.includes('GHSA'));
  const outdated = findings.filter((f) => f.message.includes('behind'));
  const unused = findings.filter((f) => f.message.includes('Unused dep'));

  if (vulns.length > 0) actions.push(`- Run \`npm audit fix\` to patch ${vulns.length} known vulnerabilities.`);
  if (outdated.length > 0) actions.push(`- Run \`npm outdated\` and update ${outdated.length} outdated packages. Prioritize major version bumps.`);
  if (unused.length > 0) actions.push(`- Remove ${unused.length} unused dependencies: \`npm uninstall ${unused.map((f) => f.message.match(/Unused (?:dev)?[Dd]ependency: (.+)/)?.[1]).filter(Boolean).join(' ')}\``);

  if (actions.length === 0) {
    actions.push('- Review dependency health with `npm outdated` and `npm audit`.');
  }

  return {
    filePath,
    summary: `${findings.length} dependency issue${findings.length > 1 ? 's' : ''} found`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

function gitHealthTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions: string[] = [];

  const hasBusFactor = findings.some((f) => f.message.includes('Knowledge silo') || f.message.includes('bus factor'));
  const hasChurn = findings.some((f) => f.message.includes('churn'));
  const hasTodo = findings.some((f) => f.message.includes('TODO') || f.message.includes('FIXME'));

  if (hasBusFactor) actions.push('- Knowledge silo detected. For team projects, ensure multiple contributors review this file. For solo projects, this is informational.');
  if (hasChurn) actions.push('- High churn file — changes here are risky. Consider refactoring to reduce change frequency, or add tests to catch regressions.');
  if (hasTodo) actions.push('- Old TODOs detected. Address or remove stale TODOs that are no longer relevant.');

  for (const f of findings) {
    if (f.suggestion && !actions.some((a) => a.includes(f.suggestion!))) {
      actions.push(`- ${f.suggestion}`);
    }
  }

  if (actions.length === 0) {
    actions.push('- Review git history for this file to understand change patterns and ownership.');
  }

  return {
    filePath,
    summary: `Git health concern in ${filePath}`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

function deadCodeTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return '- Remove unused code to reduce bundle size and maintenance burden.';
  });

  return {
    filePath,
    summary: `${findings.length} dead code issue${findings.length > 1 ? 's' : ''} in ${filePath}`,
    details,
    actions: [...new Set(actions)],
    context: contextLine(findings[0]),
  };
}

function genericTemplate(findings: PrioritizedFinding[]): PromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const actions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    if (f.message.includes('complexity')) return `- Refactor to reduce complexity: extract helper functions and split conditional branches.`;
    if (f.message.includes('lines of code')) return `- Split this file into smaller, focused modules.`;
    if (f.message.includes('Unused export')) return `- Remove the unused export or verify it is needed by external consumers.`;
    if (f.message.includes('Knowledge silo')) return `- Informational: single-author file. For team projects, consider code review rotation.`;
    if (f.message.includes('churn')) return `- High churn file — add tests to catch regressions from frequent changes.`;
    return `- Review: ${f.message}`;
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
  churn: gitHealthTemplate,
  'todo-age': gitHealthTemplate,
  staleness: gitHealthTemplate,
  'dead-code': deadCodeTemplate,
  'dead-dependency': deadCodeTemplate,
  'dead-file': deadCodeTemplate,
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
