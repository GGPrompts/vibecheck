/**
 * Evaluation scorer for assessing external repositories for adoption.
 *
 * Shifts perspective from "fix this" to "here's what you'd face if you adopt this."
 * Uses different scoring weights than the maintenance-oriented `computeOverallScore`.
 */

export type EvaluationVerdict = 'low-risk' | 'moderate-risk' | 'high-risk' | 'avoid';

export interface EvaluationResult {
  /** 0-100, higher = riskier */
  adoptionRisk: number;
  verdict: EvaluationVerdict;
  reasons: string[];
}

interface ModuleResultInput {
  moduleId: string;
  score: number;
  confidence: number;
}

interface MetricsInput {
  /** Number of dependencies that are 3+ major versions behind */
  outdatedMajorDeps?: number;
  /** Total number of dependencies */
  totalDeps?: number;
  /** Whether any critical CVE was found */
  hasCriticalCVE?: boolean;
  /** Number of critical vulnerabilities */
  criticalVulnCount?: number;
  /** Number of high vulnerabilities */
  highVulnCount?: number;
  /** Percentage of commits from the top contributor (0-100) */
  topContributorPercent?: number;
  /** Whether the top contributor has been inactive (no commits in 6+ months) */
  topContributorInactive?: boolean;
  /** Number of TODO/FIXME/HACK comments */
  todoCount?: number;
  /** Total lines of code */
  totalLOC?: number;
  /** Days since last commit */
  daysSinceLastCommit?: number;
}

/** Weights for evaluation mode (higher = more influence on risk) */
const EVAL_WEIGHTS: Record<string, number> = {
  dependencies: 2,
  dependency: 2,
  security: 1.5,
  'git-health': 1.5,
  'git_health': 1.5,
  'bus-factor': 1.5,
  'bus_factor': 1.5,
  complexity: 1,
  'code-quality': 1,
  'code_quality': 1,
};

function getWeight(moduleId: string): number {
  return EVAL_WEIGHTS[moduleId] ?? 1;
}

/**
 * Compute an adoption-risk score for an external repository.
 *
 * Unlike `computeOverallScore` (where high = good), a high adoption-risk
 * score means the repo is *riskier* to adopt.
 *
 * The function first computes a weighted "health" score (0-100, higher = healthier)
 * from module results, then inverts it and applies penalty bumps for
 * hard-stop signals (critical CVEs, abandoned maintenance, bus-factor risk).
 */
export function computeEvaluationScore(
  results: ModuleResultInput[],
  metrics: MetricsInput = {},
): EvaluationResult {
  const reasons: string[] = [];

  // ---- Hard stop: critical CVEs ----
  if (metrics.hasCriticalCVE || (metrics.criticalVulnCount && metrics.criticalVulnCount > 0)) {
    const count = metrics.criticalVulnCount ?? 1;
    reasons.push(
      `BLOCKING: ${count} critical CVE${count > 1 ? 's' : ''} found -- must be resolved before adoption`,
    );
    return { adoptionRisk: 100, verdict: 'avoid', reasons };
  }

  // ---- Weighted health score (0-100, higher = healthier) ----
  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of results) {
    const baseWeight = getWeight(result.moduleId);
    const effectiveWeight = baseWeight * result.confidence;
    weightedSum += result.score * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  const healthScore = totalWeight > 0 ? weightedSum / totalWeight : 50;

  // Invert: risk = 100 - health
  let risk = 100 - healthScore;

  // ---- Penalty: outdated dependencies (3+ major versions behind) ----
  if (metrics.outdatedMajorDeps && metrics.outdatedMajorDeps > 0) {
    const depRatio =
      metrics.totalDeps && metrics.totalDeps > 0
        ? metrics.outdatedMajorDeps / metrics.totalDeps
        : 0;
    if (metrics.outdatedMajorDeps >= 5 || depRatio > 0.3) {
      reasons.push(
        `${metrics.outdatedMajorDeps} dependencies are 3+ major versions behind -- likely abandoned or costly to update`,
      );
      risk = Math.min(100, risk + 15);
    } else {
      reasons.push(
        `${metrics.outdatedMajorDeps} dependencies are 3+ major versions behind`,
      );
      risk = Math.min(100, risk + 5);
    }
  }

  // ---- Penalty: high vulnerabilities ----
  if (metrics.highVulnCount && metrics.highVulnCount > 0) {
    reasons.push(
      `${metrics.highVulnCount} high-severity vulnerability${metrics.highVulnCount > 1 ? 'ies' : 'y'} found`,
    );
    risk = Math.min(100, risk + metrics.highVulnCount * 3);
  }

  // ---- Penalty: bus factor ----
  if (
    metrics.topContributorPercent !== undefined &&
    metrics.topContributorPercent > 80
  ) {
    if (metrics.topContributorInactive) {
      reasons.push(
        `Bus factor risk: ${metrics.topContributorPercent}% of commits from one contributor who is now inactive`,
      );
      risk = Math.min(100, risk + 20);
    } else {
      reasons.push(
        `Bus factor concern: ${metrics.topContributorPercent}% of commits from a single contributor`,
      );
      risk = Math.min(100, risk + 8);
    }
  }

  // ---- Penalty: TODO density ----
  if (metrics.todoCount && metrics.totalLOC && metrics.totalLOC > 0) {
    const todoPer1k = (metrics.todoCount / metrics.totalLOC) * 1000;
    if (todoPer1k > 10) {
      reasons.push(
        `High TODO density: ${todoPer1k.toFixed(1)} per 1,000 LOC -- significant unfinished work`,
      );
      risk = Math.min(100, risk + 10);
    } else if (todoPer1k > 5) {
      reasons.push(
        `Moderate TODO density: ${todoPer1k.toFixed(1)} per 1,000 LOC`,
      );
      risk = Math.min(100, risk + 5);
    }
  }

  // ---- Penalty: stale repo ----
  if (metrics.daysSinceLastCommit !== undefined) {
    if (metrics.daysSinceLastCommit > 365) {
      reasons.push(
        `No commits in ${Math.round(metrics.daysSinceLastCommit / 30)} months -- likely abandoned`,
      );
      risk = Math.min(100, risk + 15);
    } else if (metrics.daysSinceLastCommit > 180) {
      reasons.push(
        `No commits in ${Math.round(metrics.daysSinceLastCommit / 30)} months -- maintenance may be winding down`,
      );
      risk = Math.min(100, risk + 8);
    }
  }

  // ---- Default reason if none so far ----
  if (reasons.length === 0) {
    if (risk < 30) {
      reasons.push('No major adoption concerns identified');
    } else if (risk < 60) {
      reasons.push('Some module scores are below healthy thresholds');
    } else {
      reasons.push('Multiple modules scored poorly -- adoption would require significant effort');
    }
  }

  // Clamp and round
  const finalRisk = Math.round(Math.max(0, Math.min(100, risk)));

  return {
    adoptionRisk: finalRisk,
    verdict: riskToVerdict(finalRisk),
    reasons,
  };
}

function riskToVerdict(risk: number): EvaluationVerdict {
  if (risk < 30) return 'low-risk';
  if (risk < 60) return 'moderate-risk';
  if (risk < 80) return 'high-risk';
  return 'avoid';
}

/**
 * Return a color for the adoption risk score.
 * Inverted from health colors: high risk = red.
 */
export function getEvaluationColor(risk: number): string {
  if (risk < 30) return 'green';
  if (risk < 60) return 'yellow';
  if (risk < 80) return 'red';
  return 'darkred';
}

/**
 * Return a human-readable label for the verdict.
 */
export function getVerdictLabel(verdict: EvaluationVerdict): string {
  switch (verdict) {
    case 'low-risk':
      return 'Low Risk';
    case 'moderate-risk':
      return 'Moderate Risk';
    case 'high-risk':
      return 'High Risk';
    case 'avoid':
      return 'Avoid';
  }
}
