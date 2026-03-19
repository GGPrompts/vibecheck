'use client';

import { Card, CardContent } from '@/components/ui/card';
import type { EvaluationResult, ScanFinding } from './types';

interface AdoptionAssessmentProps {
  evaluationResult: EvaluationResult;
  blockingFindings: ScanFinding[];
}

export function AdoptionAssessment({ evaluationResult, blockingFindings }: AdoptionAssessmentProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Adoption Assessment</h2>
      <Card className="border-dashed border-2 border-amber-500/40">
        <CardContent className="pt-4 space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Risk Factors
            </h3>
            <ul className="space-y-1">
              {evaluationResult.reasons.map((reason, i) => (
                <li key={i} className="text-sm flex items-start gap-2">
                  <span
                    className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${
                      reason.startsWith('BLOCKING')
                        ? 'bg-red-500'
                        : 'bg-amber-500'
                    }`}
                  />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
          {blockingFindings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-red-600 uppercase tracking-wide">
                Blocking Issues ({blockingFindings.length})
              </h3>
              <ul className="space-y-1">
                {blockingFindings.slice(0, 10).map((f) => (
                  <li key={f.id} className="text-sm text-red-600">
                    [{f.severity}] {f.filePath}: {f.message}
                  </li>
                ))}
                {blockingFindings.length > 10 && (
                  <li className="text-sm text-muted-foreground">
                    ...and {blockingFindings.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
