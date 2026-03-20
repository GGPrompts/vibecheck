/**
 * Prompt template for the arch-smells AI module.
 *
 * Detects architectural anti-patterns: god files, misplaced logic,
 * layer violations, and tangled dependencies.
 */

export interface ArchSmellsInput {
  files: Array<{
    filePath: string;
    lineCount: number;
    exports: string[];
    imports: string[];
    content: string;
  }>;
  projectStructure: string[];
}

interface ArchFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

interface ArchSmellsResponse {
  findings: ArchFinding[];
}

export const ARCH_SMELLS_SYSTEM = `You are a software architecture analyzer.
You identify structural anti-patterns in codebases that indicate architectural decay.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- Reference specific file paths and line numbers where the violation occurs.
- Focus on structural issues, NOT style or formatting.
- Severity guide:
  critical = layer violation that will cause maintainability crisis
             (e.g., database queries in React components)
  high     = god file with >300 lines mixing multiple concerns
  medium   = misplaced logic (business rules in UI layer or data layer)
  low      = minor architectural concern (e.g., utility growing too large)
  info     = architectural improvement suggestion`;

export function buildArchSmellsPrompt(input: ArchSmellsInput): string {
  const fileBlocks = input.files.map(
    (f) =>
      `<file path="${f.filePath}" lines="${f.lineCount}" exports="${f.exports.join(', ')}" imports="${f.imports.join(', ')}">
${f.content}
</file>`
  );

  const structureList = input.projectStructure.map((s) => `  - ${s}`).join('\n');

  return `Analyze the following codebase for architectural anti-patterns.

<project-structure>
${structureList}
</project-structure>

${fileBlocks.join('\n\n')}

Detect:
1. GOD_FILE        — file >300 lines that mixes multiple unrelated concerns
                     (e.g., data fetching + business logic + UI rendering in one file)
2. MISPLACED_LOGIC — logic in the wrong architectural layer:
                     - Database/ORM calls in UI components or API route handlers
                     - Business rules embedded in data access layer
                     - UI formatting in backend services
3. LAYER_VIOLATION — imports that skip layers or create circular layer dependencies:
                     - UI importing directly from DB layer (skipping service/API)
                     - Shared/lib code importing from app-specific code
4. BARREL_BLOAT    — index.ts re-exporting everything, forcing large bundle imports
5. MIXED_CONCERNS  — single file handling both command (mutation) and query patterns,
                     or mixing infrastructure with domain logic

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<relative path>",
      "line": <line number where the smell is most evident>,
      "message": "<category>: <description>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific refactoring action>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
