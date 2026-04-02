import assert from 'node:assert/strict';
import test from 'node:test';
import { computeOverallScore, summarizeScoreResults } from '../lib/modules/scoring';

test('computeOverallScore ignores not-applicable, unavailable, and negative results', () => {
  const score = computeOverallScore([
    { moduleId: 'security', score: 80, confidence: 1, state: 'completed' },
    { moduleId: 'dependencies', score: 20, confidence: 0.5, state: 'completed' },
    { moduleId: 'build', score: 0, confidence: 1, state: 'not_applicable' },
    { moduleId: 'lint', score: 99, confidence: 1, state: 'unavailable' },
    { moduleId: 'test', score: -1, confidence: 1, state: 'completed' },
  ]);

  assert.equal(score, 60);
});

test('summarizeScoreResults tracks completed, not applicable, unavailable, and neutral states', () => {
  const summary = summarizeScoreResults([
    { moduleId: 'security', score: 80, confidence: 1, state: 'completed' },
    { moduleId: 'dependencies', score: 50, confidence: 1, state: 'completed' },
    { moduleId: 'build', score: 0, confidence: 1, state: 'not_applicable' },
    { moduleId: 'lint', score: 0, confidence: 1, state: 'unavailable' },
    { moduleId: 'test', score: -1, confidence: 1, state: 'skipped' },
  ]);

  assert.deepEqual(summary, {
    total: 5,
    scored: 2,
    passing: 1,
    notApplicable: 1,
    neutral: 1,
    unavailable: 1,
  });
});
