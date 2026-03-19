/**
 * Prompt template for the doc-staleness AI module.
 *
 * Compares README / documentation content against the actual project structure
 * to detect stale, missing, or misleading documentation.
 */

export interface DocStalenessInput {
  readmeContent: string;
  projectStructure: string[];
  publicApis: string[];
  packageJson?: string;
}

export interface DocFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

export interface DocStalenessResponse {
  findings: DocFinding[];
}

export const DOC_STALENESS_SYSTEM = `You are a documentation quality analyzer.
You compare project documentation against actual project structure and code to find discrepancies.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- For findings in the README, use line numbers from the README content.
- For missing documentation, use line 0 and reference the undocumented file/API.
- Severity guide:
  critical = documented feature/API that no longer exists (actively misleading)
  high     = public API with no documentation at all
  medium   = documented example that no longer works or references wrong paths
  low      = minor mismatch (e.g., slightly outdated install instructions)
  info     = documentation improvement suggestion`;

export function buildDocStalenessPrompt(input: DocStalenessInput): string {
  const apiList = input.publicApis.length > 0
    ? input.publicApis.map((a) => `  - ${a}`).join('\n')
    : '  (none detected)';

  const structureList = input.projectStructure.map((s) => `  - ${s}`).join('\n');

  const packageSection = input.packageJson
    ? `<package-json>
${input.packageJson}
</package-json>`
    : '';

  return `Analyze the project documentation for staleness and accuracy.

<readme>
${input.readmeContent}
</readme>

<project-structure>
${structureList}
</project-structure>

<public-apis>
${apiList}
</public-apis>

${packageSection}

Check for:
1. PHANTOM_REFERENCE — README mentions files, directories, commands, or APIs that don't exist
2. MISSING_DOCS      — public APIs or exported modules with no README coverage
3. STALE_EXAMPLE     — code examples that reference wrong imports, paths, or function signatures
4. WRONG_INSTALL     — install/setup instructions that don't match package.json
5. MISSING_SECTION   — README lacks essential sections (setup, usage, API reference for a library)

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<file where issue is, typically README.md>",
      "line": <line number in that file, or 0 if N/A>,
      "message": "<category>: <description>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific fix>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
