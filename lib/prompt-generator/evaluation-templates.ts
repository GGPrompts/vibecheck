import type { PrioritizedFinding } from './prioritizer';

/**
 * Evaluation-focused prompt templates.
 *
 * These shift language from "fix this" to "if you adopt this repo, you'll need to:"
 * and include effort estimates plus blocking/non-blocking classification.
 */

interface EvaluationPromptSection {
  filePath: string;
  summary: string;
  details: string[];
  adoptionActions: string[];
  effort: 'low' | 'medium' | 'high';
  blocking: boolean;
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
  return parts.join(' | ');
}

function estimateEffort(findings: PrioritizedFinding[]): 'low' | 'medium' | 'high' {
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const hasHigh = findings.some((f) => f.severity === 'high');
  if (hasCritical || findings.length > 5) return 'high';
  if (hasHigh || findings.length > 2) return 'medium';
  return 'low';
}

function isBlocking(findings: PrioritizedFinding[]): boolean {
  return findings.some(
    (f) =>
      f.severity === 'critical' ||
      (f.category === 'security' && f.severity === 'high'),
  );
}

export function evalComplexityTemplate(findings: PrioritizedFinding[]): EvaluationPromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const effort = estimateEffort(findings);
  const blocking = false; // Complexity is never blocking for adoption

  const adoptionActions = [
    `- If you adopt this repo, plan to refactor ${filePath} early -- high complexity will slow onboarding`,
    '- Extract helper functions and reduce nesting to make the code approachable for your team',
  ];

  if (findings.length > 3) {
    adoptionActions.push(
      '- Consider whether this file\'s complexity reflects domain complexity or poor structure',
    );
  }

  return {
    filePath,
    summary: `Complexity debt in ${filePath}`,
    details,
    adoptionActions,
    effort,
    blocking,
    context: contextLine(findings[0]),
  };
}

export function evalSecurityTemplate(findings: PrioritizedFinding[]): EvaluationPromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const effort = estimateEffort(findings);
  const blocking = isBlocking(findings);

  const adoptionActions: string[] = [];

  if (blocking) {
    adoptionActions.push(
      '- BLOCKING: These security issues must be resolved before adopting this repository',
    );
    adoptionActions.push(
      '- Run `npm audit` to verify vulnerability status and check for available patches',
    );
  } else {
    adoptionActions.push(
      '- Review these security findings before adoption -- they may require immediate patching',
    );
  }

  adoptionActions.push(
    '- Check if upstream has addressed these issues in newer releases',
  );

  // License/security warning
  adoptionActions.push(
    '- Verify that the repository\'s license is compatible with your project requirements',
  );

  return {
    filePath,
    summary: `Security concern in ${filePath}`,
    details,
    adoptionActions,
    effort,
    blocking,
    context: contextLine(findings[0]),
  };
}

export function evalDependencyTemplate(findings: PrioritizedFinding[]): EvaluationPromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${f.message}`);
  const effort = estimateEffort(findings);
  const blocking = findings.length > 5 && findings.some((f) => f.severity === 'high');

  const adoptionActions = [
    `- If you adopt this repo, budget time to update ${findings.length} outdated dependenc${findings.length > 1 ? 'ies' : 'y'}`,
    '- Run `npm outdated` to see full version gaps and check for breaking changes in changelogs',
  ];

  if (findings.some((f) => f.severity === 'high' || f.severity === 'critical')) {
    adoptionActions.push(
      '- Dependencies 3+ major versions behind often have breaking API changes -- expect migration effort',
    );
  }

  return {
    filePath,
    summary: `${findings.length} dependency update${findings.length > 1 ? 's' : ''} needed for adoption`,
    details,
    adoptionActions,
    effort,
    blocking,
    context: contextLine(findings[0]),
  };
}

export function evalGitHealthTemplate(findings: PrioritizedFinding[]): EvaluationPromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const effort = estimateEffort(findings);
  const blocking = isBlocking(findings);

  const adoptionActions = [
    '- Assess the project\'s bus factor: if a key contributor leaves, can the codebase survive?',
    '- Review contribution patterns -- single-author repos carry higher adoption risk',
  ];

  if (findings.some((f) => f.message.toLowerCase().includes('inactive'))) {
    adoptionActions.push(
      '- WARNING: Key contributors appear inactive -- you may be taking on a maintenance orphan',
    );
  }

  return {
    filePath,
    summary: `Maintenance risk in ${filePath}`,
    details,
    adoptionActions,
    effort,
    blocking,
    context: contextLine(findings[0]),
  };
}

export function evalGenericTemplate(findings: PrioritizedFinding[]): EvaluationPromptSection {
  const filePath = findings[0].filePath;
  const details = findings.map((f) => `- ${locationString(f)}: ${f.message}`);
  const effort = estimateEffort(findings);
  const blocking = isBlocking(findings);

  const adoptionActions = findings.map((f) => {
    if (f.suggestion) return `- ${f.suggestion}`;
    return `- Review this ${f.severity} issue -- it may need attention after adoption`;
  });

  return {
    filePath,
    summary: `Issue${findings.length > 1 ? 's' : ''} to address in ${filePath}`,
    details,
    adoptionActions: [...new Set(adoptionActions)],
    effort,
    blocking,
    context: contextLine(findings[0]),
  };
}

const EVAL_CATEGORY_TEMPLATES: Record<
  string,
  (findings: PrioritizedFinding[]) => EvaluationPromptSection
> = {
  complexity: evalComplexityTemplate,
  security: evalSecurityTemplate,
  dependency: evalDependencyTemplate,
  dependencies: evalDependencyTemplate,
  'git-health': evalGitHealthTemplate,
  'git_health': evalGitHealthTemplate,
  'bus-factor': evalGitHealthTemplate,
  'bus_factor': evalGitHealthTemplate,
};

export function selectEvaluationTemplate(
  findings: PrioritizedFinding[],
): (findings: PrioritizedFinding[]) => EvaluationPromptSection {
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

  return EVAL_CATEGORY_TEMPLATES[topCategory] ?? evalGenericTemplate;
}

/**
 * Format an evaluation section into readable text.
 */
export function formatEvaluationSection(
  index: number,
  section: EvaluationPromptSection,
): string {
  const lines: string[] = [];
  const effortBadge = `[Effort: ${section.effort.toUpperCase()}]`;
  const blockingBadge = section.blocking ? ' [BLOCKING]' : ' [Non-blocking]';

  lines.push(`### ${index}. ${section.summary} ${effortBadge}${blockingBadge}`);
  lines.push(`File: ${section.filePath}`);
  lines.push('');
  lines.push("**What you'll encounter:**");
  for (const d of section.details) {
    lines.push(d);
  }
  lines.push('');
  lines.push('**If you adopt this repo, you\'ll need to:**');
  for (const a of section.adoptionActions) {
    lines.push(a);
  }
  lines.push('');
  lines.push(`_${section.context}_`);
  return lines.join('\n');
}
