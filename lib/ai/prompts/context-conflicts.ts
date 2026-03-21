/**
 * Prompt template for the context-conflicts AI module.
 *
 * Analyzes documentation and context files for contradictions, stale
 * references, and conflicting instructions — a problem specific to the
 * AI-assisted development era where projects accumulate CLAUDE.md,
 * README.md, .cursorrules, AGENTS.md, and other instruction files that
 * can drift out of sync with each other and with the actual codebase.
 */

export interface ContextConflictsInput {
  filePath: string;
  content: string;
  language: string;
}

interface ContextConflictsFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

interface _ContextConflictsResponse {
  findings: ContextConflictsFinding[];
}

export const CONTEXT_CONFLICTS_SYSTEM = `You are a documentation and context consistency analyzer for software projects.
You specialize in finding contradictions, stale references, and conflicting instructions across
the many documentation and configuration files that accumulate in modern AI-assisted development.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- Every finding must reference a specific file path and line number where the conflict occurs.
- When two files contradict each other, create a finding for EACH file involved.
- Severity guide:
  critical = contradictory instructions that would confuse an AI agent (e.g., CLAUDE.md says "use yarn" but README says "use npm", or two files give opposite architectural guidance)
  high     = conflicting architecture claims (e.g., AGENTS.md describes a module structure that doesn't match actual files, or package.json scripts contradict documented commands)
  medium   = stale references to files, functions, APIs, or paths that no longer exist
  low      = minor inconsistencies (e.g., slightly different terminology for the same concept across files)
  info     = ambiguous instructions that could be interpreted multiple ways, or missing context that would help AI agents`;

export function buildContextConflictsPrompt(files: ContextConflictsInput[]): string {
  const fileBlocks = files.map(
    (f) =>
      `<file path="${f.filePath}" language="${f.language}">
${f.content}
</file>`
  );

  return `Analyze the following documentation, configuration, and context files for conflicts and inconsistencies.

Detect:
1. CONTRADICTORY_INSTRUCTIONS — Two or more files give opposite or incompatible guidance
   (e.g., CLAUDE.md says "always use TypeScript strict mode" but .cursorrules says "skip strict checks")
2. COMMAND_MISMATCH          — package.json scripts or documented commands don't match what's described
                               in README, CLAUDE.md, or other instruction files
3. ENV_MISMATCH              — .env.example variables don't match what the code actually reads,
                               or documented env vars are missing from .env.example
4. ARCHITECTURE_DRIFT        — Claims about file structure, module organization, or tech stack
                               that don't match the actual project layout
5. STALE_REFERENCE           — References to files, functions, endpoints, or APIs that no longer exist
                               in the project
6. CONVENTION_CONFLICT       — Conflicting style or convention instructions across files
                               (e.g., one file says "use default exports" while another says "use named exports")
7. AMBIGUOUS_GUIDANCE        — Instructions that are vague enough to be interpreted in contradictory ways
                               by different AI agents or developers

${fileBlocks.join('\n\n')}

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<relative path to the file containing the conflict>",
      "line": <line number>,
      "message": "<category>: <description of the conflict, referencing the other file(s) involved>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific fix: which file to update, what to change, or which instruction should win>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
