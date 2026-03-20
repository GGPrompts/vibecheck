/**
 * Prompt template for the doc-accuracy AI module.
 *
 * Analyzes documentation files (README.md, CLAUDE.md, AGENTS.md, JSDoc, etc.)
 * against actual source code to detect inaccuracies: wrong file paths, outdated
 * API descriptions, broken setup instructions, and stale architecture claims.
 */

export interface DocAccuracyInput {
  filePath: string;
  content: string;
  language: string;
}

interface DocAccuracyFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

interface DocAccuracyResponse {
  findings: DocAccuracyFinding[];
}

export const DOC_ACCURACY_SYSTEM = `You are a documentation accuracy analyzer.
You compare documentation files against actual source code to find claims, paths,
API descriptions, and instructions that no longer match reality.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- Every finding must reference the documentation file and a specific line number where the inaccuracy appears.
- Only report issues you can verify from the provided source files. Do not speculate about code you have not seen.
- Severity guide:
  critical = instructions that would break setup or cause errors (e.g., wrong install command, missing required env var)
  high     = wrong API docs: function signatures, parameter names, or return types that don't match implementation
  medium   = outdated architecture claims: file paths that don't exist, components described that were removed or renamed
  low      = minor inaccuracies: slightly wrong defaults, imprecise descriptions
  info     = documentation that could be clearer or more specific, but is not technically wrong`;

export function buildDocAccuracyPrompt(
  docFiles: DocAccuracyInput[],
  sourceFiles: DocAccuracyInput[]
): string {
  const docBlocks = docFiles.map(
    (f) =>
      `<doc path="${f.filePath}" language="${f.language}">
${f.content}
</doc>`
  );

  const sourceBlocks = sourceFiles.map(
    (f) =>
      `<source path="${f.filePath}" language="${f.language}">
${f.content}
</source>`
  );

  return `Compare the following documentation files against the provided source files.
Find claims in the documentation that are inaccurate, outdated, or misleading when compared to the actual code.

Detect:
1. WRONG_PATH         — file or directory paths mentioned in docs that don't exist in the source tree
2. WRONG_API          — function signatures, parameter names, return types, or class structures
                        described in docs that don't match the actual implementation
3. STALE_ARCHITECTURE — architecture descriptions, component relationships, or data flow
                        diagrams that no longer reflect the codebase
4. BROKEN_SETUP       — install commands, build steps, environment variable names, or
                        configuration examples that would fail or produce wrong results
5. WRONG_CONFIG       — configuration option names, default values, or formats described
                        in docs that don't match what the code actually accepts
6. MISLEADING_EXAMPLE — code examples in docs that would not compile or produce different
                        results than described

=== DOCUMENTATION FILES ===

${docBlocks.join('\n\n')}

=== SOURCE FILES (ground truth) ===

${sourceBlocks.join('\n\n')}

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<path of the documentation file containing the inaccuracy>",
      "line": <line number in the doc file>,
      "message": "<category>: <description of what the doc claims vs what the code actually does>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific correction to make the documentation accurate>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
