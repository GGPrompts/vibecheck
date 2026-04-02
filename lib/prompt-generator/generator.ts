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
  type PrioritizedFinding,
} from './prioritizer';
import { selectTemplate, formatSection, type PromptSection } from './templates';
import { estimateTokens } from './token-estimator';
import type { Severity } from '@/lib/modules/types';

const MAX_FINDING_GROUPS = 10;

export interface NextActionBundle {
  file_path: string;
  summary: string;
  rationale: string;
  details: string[];
  suggested_actions: string[];
  suggested_commands: string[];
  modules: string[];
  severities: Severity[];
  task_type: 'deterministic' | 'exploratory';
  finding_ids: string[];
}

interface GeneratePromptResult {
  prompt: string;
  estimated_tokens: number;
  actions: NextActionBundle[];
}

function normalizeActionLine(action: string): string {
  return action.replace(/^- /, '').trim();
}

function extractCommands(actions: string[]): string[] {
  const commands = new Set<string>();
  for (const action of actions) {
    for (const match of action.matchAll(/`([^`]+)`/g)) {
      commands.add(match[1]);
    }
  }
  return Array.from(commands);
}

function deriveTaskType(
  findings: PrioritizedFinding[],
  commands: string[],
): 'deterministic' | 'exploratory' {
  if (commands.length > 0) return 'deterministic';
  if (findings.some((f) => f.suggestion)) return 'deterministic';
  if (findings.every((f) => ['security', 'dependencies', 'dead-code', 'dead-dependency', 'type-assertion', 'any-usage', 'ts-directive'].includes(f.category))) {
    return 'deterministic';
  }
  return 'exploratory';
}

function buildActionBundle(
  findings: PrioritizedFinding[],
  section: PromptSection,
): NextActionBundle {
  const suggestedActions = section.actions.map(normalizeActionLine);
  const suggestedCommands = extractCommands(suggestedActions);

  return {
    file_path: section.filePath,
    summary: section.summary,
    rationale: section.context,
    details: section.details.map(normalizeActionLine),
    suggested_actions: suggestedActions,
    suggested_commands: suggestedCommands,
    modules: Array.from(new Set(findings.map((f) => f.moduleId))),
    severities: Array.from(new Set(findings.map((f) => f.severity))),
    task_type: deriveTaskType(findings, suggestedCommands),
    finding_ids: findings.map((f) => f.id),
  };
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
        suggestion: f.suggestion,
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

    return { prompt, estimated_tokens, actions: [] };
  }

  // Prioritize and group
  const prioritized = prioritizeFindings(enrichedFindings);
  const groups = groupByFile(prioritized);
  const topGroups = groups.slice(0, MAX_FINDING_GROUPS);

  // Build the prompt
  const sections: string[] = [];
  const actions: NextActionBundle[] = [];

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
    actions.push(buildActionBundle(group.findings, section));
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

  return { prompt: promptText, estimated_tokens, actions };
}
