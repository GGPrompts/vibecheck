/**
 * Prompt template for the error-handling AI module.
 *
 * Analyzes source code for error handling anti-patterns: empty catch blocks,
 * swallowed errors, missing cleanup, exposed internals, unhandled async,
 * and silent failures.
 */

export interface ErrorHandlingInput {
  filePath: string;
  content: string;
  language: string;
}

interface ErrorHandlingFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

interface ErrorHandlingResponse {
  findings: ErrorHandlingFinding[];
}

export const ERROR_HANDLING_SYSTEM = `You are a code quality analyzer specializing in error handling patterns.
You evaluate source code for error handling anti-patterns that lead to silent failures, resource leaks, security exposures, and poor debuggability.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- Every finding must reference a specific line number and the relevant code construct.
- Severity guide:
  critical = error handling flaw that will cause data loss, security breach, or crash in production
  high     = error swallowed silently, resource leak, or unhandled async that will cause hard-to-debug issues
  medium   = broad catch without type narrowing, or lost error context that harms debuggability
  low      = silent default return on error without indication, minor anti-pattern
  info     = suggestion for improvement, not a defect`;

export function buildErrorHandlingPrompt(files: ErrorHandlingInput[]): string {
  const fileBlocks = files.map(
    (f) =>
      `<file path="${f.filePath}" language="${f.language}">
${f.content}
</file>`
  );

  return `Analyze the following source files for error handling issues.

Detect:
1. EMPTY_CATCH         — catch blocks that silently swallow errors with no logging,
                         re-throw, or meaningful handling (severity: high)
2. BROAD_CATCH         — catching generic Error/Exception without type narrowing;
                         catches that handle all error types identically (severity: medium)
3. MISSING_CLEANUP     — missing finally blocks or cleanup in error paths; file handles,
                         connections, or resources that may leak on error (severity: high)
4. ERROR_EXPOSURE      — error messages that expose internal details, stack traces,
                         file paths, or sensitive data to end users (severity: high)
5. UNHANDLED_ASYNC     — floating promises without .catch(), async functions without
                         try/catch at boundary points, missing error handlers on
                         event emitters or streams (severity: high)
6. SWALLOWED_CONTEXT   — catch blocks that log the error but lose the error chain by
                         not re-throwing or wrapping in a new error with cause (severity: medium)
7. MISSING_ERROR_HANDLING — functions that call external APIs, perform file I/O, or
                         database operations without any error handling (severity: medium)
8. SILENT_FAILURE      — functions that return default/fallback values on error without
                         any indication to the caller that an error occurred (severity: low)

${fileBlocks.join('\n\n')}

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<relative path>",
      "line": <line number>,
      "message": "<category>: <description of the issue>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific fix or improvement>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
