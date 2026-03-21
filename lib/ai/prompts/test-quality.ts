/**
 * Prompt template for the test-quality AI module.
 *
 * Analyzes test files for quality issues: meaningless assertions,
 * missing edge cases, implementation-coupled tests, and poor structure.
 */

export interface TestQualityInput {
  testFiles: Array<{
    filePath: string;
    content: string;
  }>;
  sourceFiles?: Array<{
    filePath: string;
    content: string;
  }>;
}

interface TestFinding {
  filePath: string;
  line: number;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  suggestion: string;
}

interface _TestQualityResponse {
  findings: TestFinding[];
}

export const TEST_QUALITY_SYSTEM = `You are a test quality analyzer.
You evaluate test suites for effectiveness, identifying tests that provide false confidence
or miss important scenarios.

Rules:
- Respond ONLY with valid JSON matching the specified schema.
- Do not include markdown fences, commentary, or explanation outside the JSON.
- Reference specific test file paths and line numbers.
- Focus on test effectiveness, not test style preferences.
- Severity guide:
  critical = test that always passes regardless of code correctness
             (e.g., expect(true).toBe(true), no assertions at all)
  high     = test that verifies implementation details instead of behavior
             (will break on any refactor even if behavior is preserved)
  medium   = missing edge case coverage for error paths, boundary values, or null/undefined
  low      = test structure issue (e.g., test doing too many things, unclear test name)
  info     = test improvement suggestion`;

export function buildTestQualityPrompt(input: TestQualityInput): string {
  const testBlocks = input.testFiles.map(
    (f) =>
      `<test-file path="${f.filePath}">
${f.content}
</test-file>`
  );

  const sourceBlocks = input.sourceFiles
    ? input.sourceFiles.map(
        (f) =>
          `<source-file path="${f.filePath}">
${f.content}
</source-file>`
      )
    : [];

  const sourceSection = sourceBlocks.length > 0
    ? `The following source files are tested by the above tests:

${sourceBlocks.join('\n\n')}`
    : '';

  return `Analyze the following test files for quality issues.

${testBlocks.join('\n\n')}

${sourceSection}

Detect:
1. MEANINGLESS_ASSERTION — assertions that test nothing useful:
   - expect(value).toBeTruthy() when a specific value check is needed
   - expect(true).toBe(true) or equivalent tautologies
   - no expect/assert calls in the test body at all
   - only checking that a function "does not throw" without verifying output
2. IMPLEMENTATION_COUPLING — tests tightly coupled to implementation:
   - asserting on internal state or private method calls
   - mocking so extensively that the test verifies mock wiring, not behavior
   - testing exact function call order when order doesn't matter
3. MISSING_EDGE_CASES — obvious gaps in coverage:
   - no tests for error/rejection paths when function can fail
   - no boundary value tests (empty array, zero, negative, null)
   - no tests for concurrent/async edge cases when applicable
4. POOR_STRUCTURE — test organization issues:
   - single test doing too many unrelated assertions
   - test name doesn't describe the scenario being tested
   - duplicated setup that should be in beforeEach/beforeAll
5. FRAGILE_TEST — tests that will break unnecessarily:
   - snapshot tests on large/volatile structures
   - time-dependent tests without mocking
   - tests relying on specific execution order

Respond with JSON:
{
  "findings": [
    {
      "filePath": "<test file path>",
      "line": <line number>,
      "message": "<category>: <description>",
      "severity": "<critical|high|medium|low|info>",
      "suggestion": "<specific improvement>"
    }
  ]
}

If no issues are found, return: { "findings": [] }`;
}
