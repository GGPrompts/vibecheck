'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ModuleScoreCardProps {
  repoId: string;
  moduleId: string;
  name: string;
  score: number;
  confidence: number;
  top3Findings: { id: string; message: string }[];
}

function scoreColor(score: number): string {
  if (score > 70) return 'text-green-500';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-500';
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

export function ModuleScoreCard({
  repoId,
  moduleId,
  name,
  score,
  confidence,
  top3Findings,
}: ModuleScoreCardProps) {
  const confidencePct = Math.round(confidence * 100);

  return (
    <Link href={`/repo/${repoId}/${moduleId}`} className="block">
      <Card className="h-full transition-colors hover:bg-muted/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{name}</CardTitle>
            <Badge variant="secondary">{confidencePct}%</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className={`text-3xl font-bold ${scoreColor(score)}`}>
            {score}
          </div>
          {top3Findings.length > 0 && (
            <ul className="space-y-1">
              {top3Findings.map((f) => (
                <li
                  key={f.id}
                  className="text-xs text-muted-foreground truncate"
                  title={f.message}
                >
                  {truncate(f.message)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
