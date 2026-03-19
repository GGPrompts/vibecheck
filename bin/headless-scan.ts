/**
 * Headless scan runner for the CLI.
 * Invoked via tsx by bin/vibecheck.mjs when --prompt or --json flags are used.
 *
 * Expects the following env vars:
 *   VIBECHECK_REPO_PATH - absolute path to the repo
 *   VIBECHECK_REPO_ID   - repo ID from the database
 *   VIBECHECK_MODULES   - (optional) comma-separated list of module IDs
 *   VIBECHECK_MODE       - "prompt" | "json"
 *   VIBECHECK_THRESHOLD  - numeric threshold for exit code (default 50)
 */

// Register all modules (side-effect imports)
import '@/lib/modules/register-all';

import { runScan } from '@/lib/modules/orchestrator';
import { generatePrompt } from '@/lib/prompt-generator/generator';
import type { ScanConfig } from '@/lib/modules/orchestrator';
import { db } from '@/lib/db/client';
import { scans, moduleResults, findings as findingsTable } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const repoPath = process.env.VIBECHECK_REPO_PATH;
  const repoId = process.env.VIBECHECK_REPO_ID;
  const mode = process.env.VIBECHECK_MODE || 'prompt';
  const threshold = Number(process.env.VIBECHECK_THRESHOLD || '50');
  const modulesFilter = process.env.VIBECHECK_MODULES || '';

  if (!repoPath || !repoId) {
    process.stderr.write('Error: VIBECHECK_REPO_PATH and VIBECHECK_REPO_ID are required\n');
    process.exit(1);
  }

  // Build scan config
  const config: ScanConfig = {};
  if (modulesFilter) {
    config.enabledModules = modulesFilter.split(',').map((m) => m.trim()).filter(Boolean);
  }

  // Run the scan
  process.stderr.write('Running scan...\n');
  const scanId = await runScan(repoPath, repoId, config);

  // Load the completed scan to get overall score
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan) {
    process.stderr.write('Error: Scan record not found after completion\n');
    process.exit(1);
  }

  const overallScore = scan.overallScore ?? 0;
  process.stderr.write(`Scan complete. Overall score: ${overallScore}/100\n`);

  if (mode === 'json') {
    // Structured JSON output
    const results = db
      .select()
      .from(moduleResults)
      .where(eq(moduleResults.scanId, scanId))
      .all();

    const allFindings: Array<Record<string, unknown>> = [];
    for (const result of results) {
      const resultFindings = db
        .select()
        .from(findingsTable)
        .where(eq(findingsTable.moduleResultId, result.id))
        .all();
      for (const f of resultFindings) {
        allFindings.push({
          id: f.id,
          moduleId: result.moduleId,
          severity: f.severity,
          filePath: f.filePath,
          line: f.line,
          message: f.message,
          category: f.category,
          status: f.status,
        });
      }
    }

    const output = {
      scanId,
      repoPath,
      overallScore,
      durationMs: scan.durationMs,
      modules: results.map((r) => ({
        moduleId: r.moduleId,
        score: r.score,
        confidence: r.confidence,
        summary: r.summary,
        metrics: r.metrics ? JSON.parse(r.metrics) : {},
      })),
      findings: allFindings,
      threshold,
      pass: overallScore >= threshold,
    };

    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    // Prompt mode - generate and output the prompt
    const { prompt, estimated_tokens } = await generatePrompt(scanId);
    process.stdout.write(prompt);
    process.stderr.write(`\nEstimated tokens: ${estimated_tokens}\n`);
  }

  // Exit code based on threshold
  if (overallScore < threshold) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
