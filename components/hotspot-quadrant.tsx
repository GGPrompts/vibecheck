'use client';

// TODO: Replace with Nivo scatterplot when real data is available

interface HotspotItem {
  fileName: string;
  churn: number;
  complexity: number;
  quadrant: 'toxic' | 'frozen' | 'quick-win' | 'healthy';
}

interface HotspotQuadrantProps {
  data: HotspotItem[];
}

const QUADRANT_CONFIG = {
  toxic: { label: 'Toxic', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400' },
  frozen: { label: 'Frozen', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400' },
  'quick-win': { label: 'Quick Win', bg: 'bg-yellow-50 dark:bg-yellow-950/30', text: 'text-yellow-700 dark:text-yellow-400' },
  healthy: { label: 'Healthy', bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-700 dark:text-green-400' },
} as const;

export function HotspotQuadrant({ data }: HotspotQuadrantProps) {
  const counts: Record<string, number> = {
    toxic: 0,
    frozen: 0,
    'quick-win': 0,
    healthy: 0,
  };

  for (const item of data) {
    counts[item.quadrant] = (counts[item.quadrant] ?? 0) + 1;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {(['toxic', 'frozen', 'quick-win', 'healthy'] as const).map((q) => {
        const config = QUADRANT_CONFIG[q];
        return (
          <div
            key={q}
            className={`rounded-lg p-4 ${config.bg} flex flex-col items-center justify-center gap-1`}
          >
            <span className={`text-sm font-medium ${config.text}`}>
              {config.label}
            </span>
            <span className={`text-2xl font-bold ${config.text}`}>
              {counts[q]}
            </span>
            <span className="text-xs text-muted-foreground">files</span>
          </div>
        );
      })}
    </div>
  );
}
