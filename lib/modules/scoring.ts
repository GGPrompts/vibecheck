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
    const baseWeight = weights?.[result.moduleId] ?? 1;
    const effectiveWeight = baseWeight * result.confidence;
    weightedSum += result.score * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  if (totalWeight === 0) return 0;

  return Math.round(weightedSum / totalWeight);
}

/**
 * Returns a color label based on score thresholds.
 * - 'green' if score > 70
 * - 'yellow' if score >= 40 and <= 70
 * - 'red' if score < 40
 */
export function getScoreColor(score: number): string {
  if (score > 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

/**
 * Returns a human-readable label based on score thresholds.
 * - 'Healthy' if score > 70
 * - 'Needs Attention' if score >= 40 and <= 70
 * - 'Critical' if score < 40
 */
export function getScoreLabel(score: number): string {
  if (score > 70) return 'Healthy';
  if (score >= 40) return 'Needs Attention';
  return 'Critical';
}
