/**
 * vibecheck_findings — list findings with optional filters.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { moduleResults, findings } from '@/lib/db/schema';
import { requireRepoAndScan, jsonResponse, loadScanBundle } from './helpers.js';
import type { ToolResponse } from './helpers.js';

export const vibecheckFindingsInput = {
  repo_path: z.string().describe('Absolute path to the repository'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low', 'info'])
    .optional()
    .describe('Filter findings by severity'),
  module: z.string().optional().describe('Filter findings by module ID'),
  status: z
    .enum(['new', 'recurring', 'fixed', 'regressed'])
    .optional()
    .describe('Filter findings by status'),
  scan_id: z
    .string()
    .optional()
    .describe('Specific scan ID (defaults to latest completed scan)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max number of findings to return (default 50)'),
};

type FindingRow = {
  id: string;
  module: string;
  severity: string;
  file_path: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
  suggestion: string | null;
  module_confidence: number;
  module_state: string;
  module_state_reason: string | null;
  module_summary: string | null;
  module_metrics: Record<string, unknown> | null;
  applicable: boolean;
};

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export async function handleVibecheckFindings(args: {
  repo_path: string;
  severity?: string;
  module?: string;
  status?: string;
  scan_id?: string;
  limit?: number;
}): Promise<ToolResponse> {
  const { repo_path, severity, module, status, scan_id, limit = 50 } = args;

  let targetScanId = scan_id;

  if (!targetScanId) {
    const result = requireRepoAndScan(repo_path);
    if ('error' in result) return result.error;
    targetScanId = result.scan.id;
  }

  // Load all module results for this scan
  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, targetScanId))
    .all();

  // Optionally filter by module
  const filteredResults = module
    ? results.filter((r) => r.moduleId === module)
    : results;

  const bundle = loadScanBundle(targetScanId);

  // Collect findings
  const allFindings: FindingRow[] = [];

  for (const result of filteredResults) {
    const rows = db
      .select()
      .from(findings)
      .where(eq(findings.moduleResultId, result.id))
      .all();

    for (const f of rows) {
      if (severity && f.severity !== severity) continue;
      if (status && f.status !== status) continue;

      allFindings.push({
        id: f.id,
        module: result.moduleId,
        severity: f.severity,
        file_path: f.filePath,
        line: f.line,
        message: f.message,
        category: f.category,
        status: f.status,
        suggestion: f.suggestion,
        module_confidence: result.confidence,
        module_state: result.state,
        module_state_reason: result.stateReason,
        module_summary: result.summary,
        module_metrics: result.metrics ? JSON.parse(result.metrics) : null,
        applicable: result.state === 'completed',
      });
    }
  }

  allFindings.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
  );

  const limited = allFindings.slice(0, limit);

  return jsonResponse({
    scan_id: targetScanId,
    total: allFindings.length,
    returned: limited.length,
    modules: bundle?.modules.map((result) => ({
      module: result.moduleId,
      score: result.score,
      confidence: result.confidence,
      state: result.state,
      state_reason: result.stateReason,
      applicable: result.state === 'completed',
      summary: result.summary,
      metrics: result.metrics,
      findings_count: result.findings.length,
    })) ?? [],
    findings: limited,
  });
}
