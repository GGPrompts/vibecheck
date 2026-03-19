/**
 * Prompt template for the naming-quality AI module.
 *
 * Analyzes source code for naming issues: cryptic variables, single-letter
 * identifiers in non-trivial scopes, misleading names, and inconsistent
 * naming conventions.
 */

export interface NamingQualityInput {
  filePath: string;
  content: string;
  language: string;
}

export interface NamingFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

export interface NamingQualityResponse {
  findings: NamingFinding[];
}

export const NAMING_QUALITY_SYSTEM = `You are a code quality analyzer specializing in naming conventions.
You evaluate source code for naming issues that harm readability and maintainability.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- Every finding must reference a specific line number and identifier.
- Severity guide:
  critical = misleading name that could cause bugs (e.g., "isEnabled" that returns count)
  high     = cryptic abbreviation in public API or widely-used function
  medium   = single-letter variable in scope >10 lines, or inconsistent convention
  low      = minor naming nit (e.g., "data" as a parameter name)
  info     = suggestion for improvement, not a defect`;

export function buildNamingQualityPrompt(files: NamingQualityInput[]): string {
  const fileBlocks = files.map(
    (f) =>
      `<file path="${f.filePath}" language="${f.language}">
${f.content}
</file>`
  );

  return `Analyze the following source files for naming quality issues.

Detect:
1. CRYPTIC_NAMES    — abbreviated or unclear identifiers (e.g., "mgr", "tmp2", "proc")
2. SINGLE_LETTER    — single-letter variables used in scopes longer than 10 lines
                      (exclude loop iterators i/j/k in short loops)
3. MISLEADING       — names that suggest wrong type or behavior
                      (e.g., boolean named "count", array named "item")
4. INCONSISTENT     — mixed conventions in same file
                      (e.g., camelCase and snake_case for same kind of symbol)
5. OVERLY_GENERIC   — names like "data", "result", "temp", "info", "obj" in non-trivial context

${fileBlocks.join('\n\n')}

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<relative path>",
      "line": <line number>,
      "message": "<category>: <description of the issue>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific rename suggestion or improvement>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
