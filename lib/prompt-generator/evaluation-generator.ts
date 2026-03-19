import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  scans,
  moduleResults,
  findings as findingsTable,
  prompts,
  repos,
} from '@/lib/db/schema';
import {
  prioritizeFindings,
  groupByFile,
  type EnrichedFinding,
} from './prioritizer';
import { selectEvaluationTemplate, formatEvaluationSection } from './evaluation-templates';
import type { Severity } from '@/lib/modules/types';

const MAX_FINDING_GROUPS = 10;

/**
 * Generate an evaluation-focused prompt from a completed scan's findings.
 *
 * Unlike `generatePrompt`, this frames findings as adoption considerations
 * rather than fix-it instructions.
 */
export async function generateEvaluationPrompt(scanId: string): Promise<string> {
  // Load the scan
  const scan = db.select().from(scans).where(eq(scans.id, scanId)).get();
  if (!scan) {
    throw new Error(`Scan not found: ${scanId}`);
  }
  if (scan.status !== 'completed') {
    throw new Error(`Scan is not completed (status: ${scan.status})`);
  }

  // Load repo info
  let repoName = scan.repoId ?? 'unknown repo';
  if (scan.repoId) {
    const repo = db.select().from(repos).where(eq(repos.id, scan.repoId)).get();
    if (repo) {
      repoName = repo.name || repo.path;
    }
  }

  // Load all module results for this scan
  const results = db
    .select()
    .from(moduleResults)
    .where(eq(moduleResults.scanId, scanId))
    .all();

  // Load all findings enriched with module info
  const enrichedFindings: EnrichedFinding[] = [];

  for (const result of results) {
    const resultFindings = db
      .select()
      .from(findingsTable)
      .where(eq(findingsTable.moduleResultId, result.id))
      .all();

    for (const f of resultFindings) {
      if (f.status === 'fixed') continue;

      enrichedFindings.push({
        id: f.id,
        fingerprint: f.fingerprint,
        severity: f.severity as Severity,
        filePath: f.filePath ?? '(unknown)',
        line: f.line,
        message: f.message,
        category: f.category,
        suggestion: null,
        status: f.status,
        moduleId: result.moduleId,
        confidence: result.confidence,
      });
    }
  }

  if (enrichedFindings.length === 0) {
    const prompt = `Evaluation report for **${repoName}** (scanned ${scan.createdAt}):\n\nNo significant issues detected. This repository appears safe to adopt.\n`;

    db.insert(prompts)
      .values({
        id: nanoid(),
        scanId,
        generatedPrompt: prompt,
        findingIds: JSON.stringify([]),
      })
      .run();

    return prompt;
  }

  // Prioritize and group
  const prioritized = prioritizeFindings(enrichedFindings);
  const groups = groupByFile(prioritized);
  const topGroups = groups.slice(0, MAX_FINDING_GROUPS);

  // Classify blocking vs non-blocking
  const blockingGroups: typeof topGroups = [];
  const nonBlockingGroups: typeof topGroups = [];

  for (const group of topGroups) {
    const hasBlocker = group.findings.some(
      (f) =>
        f.severity === 'critical' ||
        (f.category === 'security' && f.severity === 'high'),
    );
    if (hasBlocker) {
      blockingGroups.push(group);
    } else {
      nonBlockingGroups.push(group);
    }
  }

  // Build the prompt
  const sections: string[] = [];

  // Header
  sections.push(`# Adoption Evaluation Report: **${repoName}**`);
  sections.push(`_Scanned: ${scan.createdAt}_\n`);
  sections.push(
    `Found ${enrichedFindings.length} issue${enrichedFindings.length !== 1 ? 's' : ''} across ${groups.length} file${groups.length !== 1 ? 's' : ''}.\n`,
  );

  // Blocking issues section
  if (blockingGroups.length > 0) {
    sections.push('---');
    sections.push('## Blocking Issues (must resolve before adoption)\n');
    let idx = 1;
    for (const group of blockingGroups) {
      const template = selectEvaluationTemplate(group.findings);
      const section = template(group.findings);
      sections.push(formatEvaluationSection(idx, section));
      sections.push('');
      idx++;
    }
  }

  // Non-blocking issues section
  if (nonBlockingGroups.length > 0) {
    sections.push('---');
    sections.push('## Non-blocking Issues (plan to address after adoption)\n');
    let idx = 1;
    for (const group of nonBlockingGroups) {
      const template = selectEvaluationTemplate(group.findings);
      const section = template(group.findings);
      sections.push(formatEvaluationSection(idx, section));
      sections.push('');
      idx++;
    }
  }

  // Footer
  sections.push('---\n');
  sections.push(
    'This is an evaluation report for external repository adoption. ' +
      'Blocking issues must be resolved before integrating this codebase. ' +
      'Non-blocking issues can be addressed incrementally after adoption.',
  );

  // License warning
  sections.push(
    '\n**Reminder:** Verify the repository\'s license compatibility with your project before proceeding.',
  );

  const promptText = sections.join('\n');

  // Collect finding IDs included in the prompt
  const includedIds = topGroups.flatMap((g) => g.findings.map((f) => f.id));

  // Store in DB
  db.insert(prompts)
    .values({
      id: nanoid(),
      scanId,
      generatedPrompt: promptText,
      findingIds: JSON.stringify(includedIds),
    })
    .run();

  return promptText;
}
