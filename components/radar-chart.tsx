'use client';

import { useTheme } from 'next-themes';
import { ResponsiveRadar } from '@nivo/radar';

interface RadarChartProps {
  data: Array<{
    moduleId: string;
    moduleName: string;
    score: number;
    confidence: number;
  }>;
}

interface RadarDatum extends Record<string, unknown> {
  module: string;
  score: number;
  confidence: number;
}

function SliceTooltip({
  index,
  data,
}: {
  index: string | number;
  data: readonly { id: string; value: number; formattedValue: string; color: string }[];
}) {
  return (
    <div className="rounded-md bg-popover px-3 py-2 text-sm shadow-md border border-border">
      <p className="font-medium text-foreground mb-1">{String(index)}</p>
      {data.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-muted-foreground">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: d.color }}
          />
          <span className="capitalize">{d.id}:</span>
          <span className="font-medium text-foreground">{d.formattedValue}</span>
        </div>
      ))}
    </div>
  );
}

export function RadarChart({ data }: RadarChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-muted-foreground text-sm">
        No module data available for radar chart.
      </div>
    );
  }

  const chartData: RadarDatum[] = data.map((d) => ({
    module: d.moduleName,
    score: d.score,
    confidence: Math.round(d.confidence * 100),
  }));

  const textColor = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark ? 'rgba(161, 161, 170, 0.15)' : 'rgba(113, 113, 122, 0.15)';

  return (
    <div className="min-h-[300px] h-[350px] w-full">
      <ResponsiveRadar<RadarDatum>
        data={chartData}
        keys={['score']}
        indexBy="module"
        maxValue={100}
        margin={{ top: 40, right: 60, bottom: 40, left: 60 }}
        curve="linearClosed"
        gridShape="circular"
        gridLevels={5}
        gridLabelOffset={16}
        enableDots={true}
        dotSize={8}
        dotColor={{ from: 'color', modifiers: [] }}
        dotBorderWidth={2}
        dotBorderColor={{ from: 'color', modifiers: [] }}
        colors={isDark ? ['#38bdf8'] : ['#2563eb']}
        fillOpacity={0.2}
        borderWidth={2}
        borderColor={{ from: 'color', modifiers: [] }}
        blendMode={isDark ? 'screen' : 'multiply'}
        isInteractive={true}
        sliceTooltip={SliceTooltip}
        theme={{
          text: {
            fill: textColor,
            fontSize: 11,
          },
          grid: {
            line: {
              stroke: gridColor,
              strokeWidth: 1,
            },
          },
          tooltip: {
            container: {
              background: 'transparent',
              padding: 0,
              borderRadius: 0,
              boxShadow: 'none',
            },
          },
        }}
      />
    </div>
  );
}
