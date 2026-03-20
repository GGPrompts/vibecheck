/**
 * Compute an overall score from individual module results using weighted averaging.
 *
 * Each module's effective weight is: weight * confidence.
 * If no explicit weights are provided, all modules are weighted equally (weight = 1).
 *
 * @returns Integer score from 0 to 100.
 */
export function computeOverallScore(
  results: Array<{ moduleId: string; score: number; confidence: number }>,
  weights?: Record<string, number>
): number {
  if (results.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const result of results) {
    // Skip failed modules (score -1) — they shouldn't drag down the overall score
    if (result.score < 0) continue;

    const baseWeight = weights?.[result.moduleId] ?? 1;
    const effectiveWeight = baseWeight * result.confidence;
    weightedSum += result.score * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  if (totalWeight === 0) return 0;

  return Math.round(weightedSum / totalWeight);
}

