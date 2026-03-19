'use client';

import { ModuleScoreCard } from '@/components/module-score-card';
import type { ScanModule } from './types';

interface ModuleGridProps {
  repoId: string;
  modules: ScanModule[];
}

export function ModuleGrid({ repoId, modules }: ModuleGridProps) {
  if (modules.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Modules</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {modules.map((mod) => (
          <ModuleScoreCard
            key={mod.moduleId}
            repoId={repoId}
            moduleId={mod.moduleId}
            name={mod.moduleId
              .split('-')
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ')}
            score={mod.score}
            confidence={mod.confidence}
            top3Findings={mod.findings.slice(0, 3).map((f) => ({
              id: f.id,
              message: f.message,
            }))}
          />
        ))}
      </div>
    </section>
  );
}
