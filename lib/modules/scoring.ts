export interface ScoreResultInput {
  moduleId: string;
  score: number;
  confidence: number;
  state?: string | null;
}

export interface ScoreSummary {
  total: number;
  scored: number;
  passing: number;
  notApplicable: number;
  neutral: number;
  unavailable: number;
}

function isScoreEligible(result: ScoreResultInput): boolean {
  if (result.state && result.state !== 'completed') {
    return false;
  }
  return result.score >= 0;
}

/**
 * Compute an overall score from individual module results using weighted averaging.
 *
 * Each module's effective weight is: weight * confidence.
 * If no explicit weights are provided, all modules are weighted equally (weight = 1).
 *
 * @returns Integer score from 0 to 100.
 */
export function computeOverallScore(
  results: ScoreResultInput[],
  weights?: Record<string, number>
): number {
  if (results.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of results) {
    if (!isScoreEligible(result)) continue;

    const baseWeight = weights?.[result.moduleId] ?? 1;
    const effectiveWeight = baseWeight * result.confidence;
    weightedSum += result.score * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  if (totalWeight === 0) return 0;

  return Math.round(weightedSum / totalWeight);
}

export function summarizeScoreResults(results: ScoreResultInput[]): ScoreSummary {
  const summary: ScoreSummary = {
    total: results.length,
    scored: 0,
    passing: 0,
    notApplicable: 0,
    neutral: 0,
    unavailable: 0,
  };

  for (const result of results) {
    if (isScoreEligible(result)) {
      summary.scored += 1;
      if (result.score > 60) {
        summary.passing += 1;
      }
      continue;
    }

    if (result.state === 'not_applicable') {
      summary.notApplicable += 1;
      continue;
    }

    if (result.state === 'unavailable') {
      summary.unavailable += 1;
      continue;
    }

    summary.neutral += 1;
  }

  return summary;
}
