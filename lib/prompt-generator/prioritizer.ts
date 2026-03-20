import type { Severity } from '@/lib/modules/types';

export interface EnrichedFinding {
  id: string;
  fingerprint: string;
  severity: Severity;
  filePath: string;
  line?: number | null;
  message: string;
  category: string;
  suggestion?: string | null;
  status: string;
  moduleId: string;
  confidence: number;
  churnRate?: number;
}

export interface PrioritizedFinding extends EnrichedFinding {
  priorityScore: number;
}

interface FindingGroup {
  filePath: string;
  findings: PrioritizedFinding[];
  groupScore: number;
}

const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function computePriorityScore(finding: EnrichedFinding): number {
  const severityWeight = SEVERITY_WEIGHTS[finding.severity] ?? 1;
  const churnMultiplier = 1 + (finding.churnRate ?? 0);

  // Critical findings use a confidence floor of 0.5 so they are never
  // suppressed too aggressively by low model confidence.
  const effectiveConfidence =
    finding.severity === 'critical'
      ? Math.max(finding.confidence, 0.5)
      : finding.confidence;

  return severityWeight * effectiveConfidence * churnMultiplier;
}

/**
 * Rank findings by composite score and return them sorted descending.
 */
export function prioritizeFindings(
  findings: EnrichedFinding[]
): PrioritizedFinding[] {
  return findings
    .map((f) => ({
      ...f,
      priorityScore: computePriorityScore(f),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Group prioritized findings by filePath. Each group's score is the
 * sum of its findings' priority scores. Groups are sorted descending.
 */
export function groupByFile(
  findings: PrioritizedFinding[]
): FindingGroup[] {
  const groups = new Map<string, PrioritizedFinding[]>();

  for (const f of findings) {
    const key = f.filePath || '(unknown)';
    const existing = groups.get(key);
    if (existing) {
      existing.push(f);
    } else {
      groups.set(key, [f]);
    }
  }

  return Array.from(groups.entries())
    .map(([filePath, grouped]) => ({
      filePath,
      findings: grouped,
      groupScore: grouped.reduce((sum, f) => sum + f.priorityScore, 0),
    }))
    .sort((a, b) => b.groupScore - a.groupScore);
}
