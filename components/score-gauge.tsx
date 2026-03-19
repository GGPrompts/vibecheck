"use client";

interface ScoreGaugeProps {
  score: number | null;
  size?: number;
}

export function ScoreGauge({ score, size = 80 }: ScoreGaugeProps) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let color = "#a1a1aa"; // gray for null
  let dashOffset = circumference; // fully empty

  if (score !== null) {
    if (score > 70) {
      color = "#22c55e";
    } else if (score >= 40) {
      color = "#eab308";
    } else {
      color = "#ef4444";
    }
    dashOffset = circumference - (score / 100) * circumference;
  }

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/50"
        />
        {/* Score arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span
        className="absolute text-sm font-bold"
        style={{ color: score !== null ? color : undefined }}
      >
        {score !== null ? score : "\u2014"}
      </span>
    </div>
  );
}
