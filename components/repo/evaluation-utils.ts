import type { ScanModule, EvaluationResult, EvaluationVerdict, ScanFinding, HotspotDataPoint, ScanDetail } from './types';

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Client-side evaluation score computation.
 * Mirrors the server-side logic in evaluation-scorer.ts.
 */
export function computeClientEvaluation(modules: ScanModule[]): EvaluationResult {
  const reasons: string[] = [];

  // Check for critical security findings (hard stop)
  const criticalSecurityFindings = modules.flatMap((m) =>
    m.findings.filter(
      (f) => f.severity === 'critical' && (f.category === 'security' || m.moduleId === 'security'),
    ),
  );

  if (criticalSecurityFindings.length > 0) {
    return {
      adoptionRisk: 100,
      verdict: 'avoid',
      reasons: [
        `BLOCKING: ${criticalSecurityFindings.length} critical security issue${criticalSecurityFindings.length > 1 ? 's' : ''} found -- must be resolved before adoption`,
      ],
    };
  }

  // Evaluation weights
  const EVAL_WEIGHTS: Record<string, number> = {
    dependencies: 2,
    dependency: 2,
    security: 1.5,
    'git-health': 1.5,
    'git_health': 1.5,
    'bus-factor': 1.5,
    'bus_factor': 1.5,
    complexity: 1,
    'code-quality': 1,
    'code_quality': 1,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const mod of modules) {
    const baseWeight = EVAL_WEIGHTS[mod.moduleId] ?? 1;
    const effectiveWeight = baseWeight * mod.confidence;
    weightedSum += mod.score * effectiveWeight;
    totalWeight += effectiveWeight;
  }

  const healthScore = totalWeight > 0 ? weightedSum / totalWeight : 50;
  let risk = 100 - healthScore;

  // Check for high-severity security findings
  const highSecurityFindings = modules.flatMap((m) =>
    m.findings.filter(
      (f) => f.severity === 'high' && (f.category === 'security' || m.moduleId === 'security'),
    ),
  );
  if (highSecurityFindings.length > 0) {
    reasons.push(
      `${highSecurityFindings.length} high-severity security issue${highSecurityFindings.length > 1 ? 's' : ''} found`,
    );
    risk = Math.min(100, risk + highSecurityFindings.length * 3);
  }

  // Check dependency modules for severely outdated deps
  const depModules = modules.filter(
    (m) => m.moduleId === 'dependencies' || m.moduleId === 'dependency',
  );
  for (const dm of depModules) {
    const critFindings = dm.findings.filter(
      (f) => f.severity === 'high' || f.severity === 'critical',
    );
    if (critFindings.length > 0) {
      reasons.push(
        `${critFindings.length} dependency update${critFindings.length > 1 ? 's' : ''} needed (high/critical)`,
      );
      risk = Math.min(100, risk + 5);
    }
  }

  // Check bus factor / git health
  const gitModules = modules.filter(
    (m) =>
      m.moduleId === 'git-health' ||
      m.moduleId === 'git_health' ||
      m.moduleId === 'bus-factor' ||
      m.moduleId === 'bus_factor',
  );
  for (const gm of gitModules) {
    if (gm.score < 40) {
      reasons.push('Git health score is low -- potential bus factor or maintenance risk');
      risk = Math.min(100, risk + 8);
    }
  }

  // Default reason
  if (reasons.length === 0) {
    if (risk < 30) {
      reasons.push('No major adoption concerns identified');
    } else if (risk < 60) {
      reasons.push('Some module scores are below healthy thresholds');
    } else {
      reasons.push(
        'Multiple modules scored poorly -- adoption would require significant effort',
      );
    }
  }

  const finalRisk = Math.round(Math.max(0, Math.min(100, risk)));

  let verdict: EvaluationVerdict;
  if (finalRisk < 30) verdict = 'low-risk';
  else if (finalRisk < 60) verdict = 'moderate-risk';
  else if (finalRisk < 80) verdict = 'high-risk';
  else verdict = 'avoid';

  return { adoptionRisk: finalRisk, verdict, reasons };
}

/** Build hotspot data from scan detail modules */
export function buildHotspotData(scanDetail: ScanDetail): HotspotDataPoint[] {
  const hotspotData: HotspotDataPoint[] = [];
  for (const mod of scanDetail.modules) {
    if (mod.metrics) {
      for (const finding of mod.findings) {
        if (finding.filePath) {
          const complexity = finding.severity === 'critical' ? 80 : finding.severity === 'high' ? 60 : 30;
          const churn = Math.random() * 100;
          let quadrant: 'toxic' | 'frozen' | 'quick-win' | 'healthy';
          if (complexity > 50 && churn > 50) quadrant = 'toxic';
          else if (complexity > 50 && churn <= 50) quadrant = 'frozen';
          else if (complexity <= 50 && churn > 50) quadrant = 'quick-win';
          else quadrant = 'healthy';
          hotspotData.push({ fileName: finding.filePath, churn, complexity, quadrant });
        }
      }
    }
  }
  return hotspotData;
}

/** Get blocking findings for evaluation mode */
export function getBlockingFindings(allFindings: ScanFinding[]): ScanFinding[] {
  return allFindings.filter(
    (f) =>
      f.severity === 'critical' ||
      (f.category === 'security' && f.severity === 'high'),
  );
}
