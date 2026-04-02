import type { LoadedModuleResult } from './helpers.js';

export function modulePayload(result: LoadedModuleResult) {
  const suggestionCount = result.findings.filter((finding) => Boolean(finding.suggestion)).length;
  return {
    module_result_id: result.id,
    module_id: result.moduleId,
    score: result.score,
    confidence: result.confidence,
    state: result.state,
    state_reason: result.stateReason,
    applicable: result.state === 'completed',
    summary: result.summary,
    metrics: result.metrics,
    findings_count: result.findings.length,
    suggestion_count: suggestionCount,
    findings: result.findings,
  };
}

export function buildHealthSuccessPayload(
  repo: { name: string; path: string },
  scan: { id: string; createdAt: string; overallScore: number | null },
  modules: LoadedModuleResult[],
) {
  return {
    repo: repo.name,
    repo_path: repo.path,
    scan_id: scan.id,
    scanned_at: scan.createdAt,
    overall_score: scan.overallScore,
    modules: modules.map(modulePayload),
    status: 'ok',
  };
}

export function buildComparePayload(
  repo: { name: string; path: string },
  base: { scan: { id: string; overallScore: number | null }; modules: LoadedModuleResult[] },
  head: { scan: { id: string; overallScore: number | null }; modules: LoadedModuleResult[] },
  limit = 10,
) {
  const baseByModule = new Map(base.modules.map((module) => [module.moduleId, module]));
  const headByModule = new Map(head.modules.map((module) => [module.moduleId, module]));
  const moduleIds = Array.from(new Set([...baseByModule.keys(), ...headByModule.keys()])).sort();

  const moduleDeltas = moduleIds.map((moduleId) => {
    const before = baseByModule.get(moduleId);
    const after = headByModule.get(moduleId);
    return {
      module_id: moduleId,
      score_before: before?.score ?? null,
      score_after: after?.score ?? null,
      delta:
        before && after ? after.score - before.score : null,
      state_before: before?.state ?? null,
      state_after: after?.state ?? null,
      findings_before: before?.findings.length ?? 0,
      findings_after: after?.findings.length ?? 0,
      regression:
        (before?.state === 'completed' && after?.state === 'completed' && before.score > after.score)
        || (before?.state !== 'not_applicable' && after?.state === 'unavailable'),
    };
  });

  const regressions = moduleDeltas.filter((entry) => entry.regression || (entry.delta != null && entry.delta < 0)).slice(0, limit);
  const improved = moduleDeltas.filter((entry) => entry.delta != null && entry.delta > 0);

  const newFindings = head.modules.flatMap((module) =>
    module.findings.filter((finding) =>
      !base.modules.some((baseModule) =>
        baseModule.findings.some((baseFinding) => baseFinding.fingerprint === finding.fingerprint)
      )
    ).map((finding) => ({
      module_id: module.moduleId,
      id: finding.id,
      severity: finding.severity,
      message: finding.message,
      suggestion: finding.suggestion,
      file_path: finding.filePath,
    }))
  );

  return {
    repo: repo.name,
    repo_path: repo.path,
    base_scan_id: base.scan.id,
    head_scan_id: head.scan.id,
    base_overall_score: base.scan.overallScore,
    head_overall_score: head.scan.overallScore,
    overall_delta:
      base.scan.overallScore != null && head.scan.overallScore != null
        ? head.scan.overallScore - base.scan.overallScore
        : null,
    regressions,
    improved: improved.slice(0, limit),
    new_findings: newFindings.slice(0, limit),
  };
}
