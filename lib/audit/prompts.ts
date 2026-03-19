/**
 * Default audit prompts per module category.
 *
 * Each prompt asks the AI to review raw source code and produce structured
 * findings in JSON. Prompts intentionally do NOT reference any scores or
 * scan results — the audit must form an independent opinion to avoid
 * anchoring bias.
 */

interface AuditPromptTemplate {
  moduleId: string;
  name: string;
  systemPrompt: string;
  buildUserPrompt: (files: Array<{ path: string; content: string }>) => string;
}

const JSON_OUTPUT_INSTRUCTIONS = `
Respond ONLY with a JSON object in this exact format (no markdown fences, no commentary):
{
  "summary": "Brief overall assessment (1-3 sentences)",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "file": "relative/path/to/file.ts",
      "line": 42,
      "message": "Description of the issue",
      "category": "category-slug"
    }
  ]
}

If there are no findings, return an empty findings array.
The "line" field is optional — omit it if you cannot determine the exact line.
`.trim();

function formatFileBlock(files: Array<{ path: string; content: string }>): string {
  return files
    .map((f) => `--- ${f.path} ---\n${f.content}\n`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Module prompt templates
// ---------------------------------------------------------------------------

const complexityPrompt: AuditPromptTemplate = {
  moduleId: 'complexity',
  name: 'Complexity Audit',
  systemPrompt: `You are a senior software engineer performing a code complexity audit. Identify functions, classes, or modules that are excessively complex, deeply nested, or difficult to understand. Focus on cyclomatic complexity, cognitive complexity, long functions, and tangled control flow. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for complexity issues. Flag overly complex functions, deep nesting, long parameter lists, and code that would be hard for a new team member to understand.\n\n${formatFileBlock(files)}`;
  },
};

const securityPrompt: AuditPromptTemplate = {
  moduleId: 'security',
  name: 'Security Audit',
  systemPrompt: `You are a security engineer performing a source code security audit. Identify vulnerabilities, insecure patterns, and potential attack vectors. Focus on injection flaws, authentication issues, hardcoded secrets, insecure defaults, and missing input validation. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for security vulnerabilities and insecure coding patterns.\n\n${formatFileBlock(files)}`;
  },
};

const dependenciesPrompt: AuditPromptTemplate = {
  moduleId: 'dependencies',
  name: 'Dependencies Audit',
  systemPrompt: `You are a software engineer auditing dependency usage and management. Identify problematic dependency patterns: unused imports, heavy dependencies that could be replaced with lighter alternatives, version pinning issues, and circular dependency risks. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for dependency and import issues. Look for unused imports, heavy transitive dependencies, inappropriate coupling, and import organization problems.\n\n${formatFileBlock(files)}`;
  },
};

const architecturePrompt: AuditPromptTemplate = {
  moduleId: 'architecture',
  name: 'Architecture Audit',
  systemPrompt: `You are a senior architect reviewing code for structural and design issues. Identify architectural smells: god objects, feature envy, inappropriate intimacy between modules, layer violations, missing abstractions, and inconsistent patterns. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for architectural issues and design smells. Consider separation of concerns, module boundaries, and design pattern usage.\n\n${formatFileBlock(files)}`;
  },
};

const testQualityPrompt: AuditPromptTemplate = {
  moduleId: 'test-quality',
  name: 'Test Quality Audit',
  systemPrompt: `You are a QA engineer auditing test code quality. Identify weak test patterns: missing edge case coverage, brittle assertions, tests that test implementation details rather than behavior, missing error path tests, and test code that is harder to maintain than the code it tests. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for test quality issues. Examine both test files and the code they test, looking for gaps in coverage and fragile test patterns.\n\n${formatFileBlock(files)}`;
  },
};

const namingPrompt: AuditPromptTemplate = {
  moduleId: 'naming-quality',
  name: 'Naming Quality Audit',
  systemPrompt: `You are a senior developer auditing code for naming and readability issues. Identify unclear variable names, misleading function names, inconsistent naming conventions, overly abbreviated identifiers, and names that don't convey intent. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for naming and readability issues. Flag names that are misleading, too vague, inconsistent with conventions, or that make the code harder to understand.\n\n${formatFileBlock(files)}`;
  },
};

const deadCodePrompt: AuditPromptTemplate = {
  moduleId: 'dead-code',
  name: 'Dead Code Audit',
  systemPrompt: `You are a software engineer auditing for dead and unreachable code. Identify unused functions, unreachable branches, commented-out code blocks, unused variables, obsolete feature flags, and code that appears to serve no current purpose. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for dead code, unused exports, unreachable branches, and commented-out code blocks.\n\n${formatFileBlock(files)}`;
  },
};

const docStalenessPrompt: AuditPromptTemplate = {
  moduleId: 'doc-staleness',
  name: 'Documentation Staleness Audit',
  systemPrompt: `You are a technical writer auditing code documentation quality. Identify stale comments that contradict the code, missing JSDoc on public APIs, misleading docstrings, TODO comments that should be tracked as issues, and documentation that describes a different behavior than the code implements. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for documentation issues. Flag stale comments, missing documentation on public APIs, and misleading docstrings.\n\n${formatFileBlock(files)}`;
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const allPrompts: AuditPromptTemplate[] = [
  complexityPrompt,
  securityPrompt,
  dependenciesPrompt,
  architecturePrompt,
  testQualityPrompt,
  namingPrompt,
  deadCodePrompt,
  docStalenessPrompt,
];

const promptsByModule = new Map<string, AuditPromptTemplate>(
  allPrompts.map((p) => [p.moduleId, p])
);

/** Get the audit prompt template for a given module ID. */
export function getAuditPrompt(moduleId: string): AuditPromptTemplate | undefined {
  return promptsByModule.get(moduleId);
}

/** Get all available audit module IDs. */
export function getAvailableAuditModules(): string[] {
  return allPrompts.map((p) => p.moduleId);
}

/** Get all audit prompt templates. */
export function getAllAuditPrompts(): AuditPromptTemplate[] {
  return [...allPrompts];
}
