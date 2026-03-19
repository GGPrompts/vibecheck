'use client';

import type { EvaluationVerdict } from './types';

export function VerdictBadge({ verdict }: { verdict: EvaluationVerdict }) {
  const config: Record<EvaluationVerdict, { label: string; className: string }> = {
    'low-risk': {
      label: 'Low Risk',
      className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700',
    },
    'moderate-risk': {
      label: 'Moderate Risk',
      className: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700',
    },
    'high-risk': {
      label: 'High Risk',
      className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700',
    },
    avoid: {
      label: 'Avoid',
      className: 'bg-red-200 text-red-900 border-red-500 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800',
    },
  };

  const c = config[verdict];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${c.className}`}
    >
      {c.label}
    </span>
  );
}
