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
import { selectTemplate, formatSection } from './templates';
import { estimateTokens } from './token-estimator';
import type { Severity } from '@/lib/modules/types';

const MAX_FINDING_GROUPS = 10;

interface GeneratePromptResult {
  prompt: string;
  estimated_tokens: number;
}

/**
 * Generate a Claude Code prompt from a completed scan's findings.
 * Loads data from DB, prioritizes, groups by file, applies templates,
 * stores the generated prompt, and returns the text with token estimate.
 */
export async function generatePrompt(scanId: string): Promise<GeneratePromptResult> {
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
      // Skip fixed findings — we only want actionable items in the prompt
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
    const prompt = `Based on vibecheck scan of ${repoName} at ${scan.createdAt}:\n\nNo actionable findings detected. Your codebase looks healthy!\n`;
    const estimated_tokens = estimateTokens(prompt);

    db.insert(prompts)
      .values({
        id: nanoid(),
        scanId,
        generatedPrompt: prompt,
        findingIds: JSON.stringify([]),
      })
      .run();

    return { prompt, estimated_tokens };
  }

  // Prioritize and group
  const prioritized = prioritizeFindings(enrichedFindings);
  const groups = groupByFile(prioritized);
  const topGroups = groups.slice(0, MAX_FINDING_GROUPS);

  // Build the prompt
  const sections: string[] = [];

  // Header
  sections.push(
    `Based on vibecheck scan of **${repoName}** at ${scan.createdAt}:\n`
  );
  sections.push(
    `Found ${enrichedFindings.length} issue${enrichedFindings.length !== 1 ? 's' : ''} across ${groups.length} file${groups.length !== 1 ? 's' : ''}. Here are the top priorities:\n`
  );
  sections.push('---\n');

  // Numbered priority sections
  for (let i = 0; i < topGroups.length; i++) {
    const group = topGroups[i];
    const template = selectTemplate(group.findings);
    const section = template(group.findings);
    sections.push(formatSection(i + 1, section));
    sections.push(''); // blank line between sections
  }

  // Footer
  sections.push('---\n');
  sections.push(
    'Focus on the top 3 items first. Each is ordered by severity \u00d7 confidence \u00d7 change frequency.'
  );

  const promptText = sections.join('\n');
  const estimated_tokens = estimateTokens(promptText);

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

  return { prompt: promptText, estimated_tokens };
}
