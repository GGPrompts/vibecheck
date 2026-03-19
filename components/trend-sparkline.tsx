"use client";

import { LineChart, Line, ResponsiveContainer } from "recharts";

interface TrendSparklineProps {
  data: number[];
}

export function TrendSparkline({ data }: TrendSparklineProps) {
  const chartData =
    data.length > 0
      ? data.map((value, index) => ({ index, value }))
      : [
          { index: 0, value: 50 },
          { index: 1, value: 50 },
          { index: 2, value: 50 },
          { index: 3, value: 50 },
          { index: 4, value: 50 },
        ];

  const hasData = data.length > 0;

  return (
    <div style={{ width: 80, height: 30 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={hasData ? "#6366f1" : "#a1a1aa"}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
