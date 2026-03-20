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

const errorHandlingPrompt: AuditPromptTemplate = {
  moduleId: 'error-handling',
  name: 'Error Handling Audit',
  systemPrompt: `You are a reliability engineer auditing error handling patterns. Identify empty catch blocks, swallowed errors, missing error boundaries, overly broad exception catching, errors that expose sensitive information, missing cleanup/finally blocks, unhandled promise rejections, and missing error propagation. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for error handling issues. Flag patterns where errors are silently swallowed, where cleanup is missing in error paths, and where error information is lost or leaked.\n\n${formatFileBlock(files)}`;
  },
};

const configQualityPrompt: AuditPromptTemplate = {
  moduleId: 'config-quality',
  name: 'Config Quality Audit',
  systemPrompt: `You are a DevOps engineer auditing configuration file quality. Identify hardcoded environment-specific values, missing config validation, insecure defaults, overly permissive settings, config duplication across files, missing TypeScript strict flags, loose ESLint configs, and config files that contradict each other. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following configuration and source files for config quality issues. Look for hardcoded values that should be environment variables, missing validation, insecure defaults, and configuration drift.\n\n${formatFileBlock(files)}`;
  },
};

const apiDesignPrompt: AuditPromptTemplate = {
  moduleId: 'api-design',
  name: 'API Design Audit',
  systemPrompt: `You are an API design expert auditing endpoint implementation quality. Identify inconsistent error response formats, missing input validation, non-RESTful patterns, missing pagination, inconsistent naming conventions across routes, missing rate limiting patterns, and overly coupled endpoint implementations. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following API route files for design quality issues. Evaluate RESTful convention adherence, error handling consistency, input validation, and response format uniformity.\n\n${formatFileBlock(files)}`;
  },
};

const loggingQualityPrompt: AuditPromptTemplate = {
  moduleId: 'logging-quality',
  name: 'Logging Quality Audit',
  systemPrompt: `You are an observability engineer auditing logging practices. Identify console.log used in production code instead of structured logging, missing log levels, sensitive data in log output (passwords, tokens, PII), missing contextual information in error logs, excessive debug logging, and missing audit trail logging for important operations. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for logging quality issues. Flag raw console.log usage, sensitive data exposure in logs, missing contextual information, and absent logging where it should exist.\n\n${formatFileBlock(files)}`;
  },
};

const performancePrompt: AuditPromptTemplate = {
  moduleId: 'performance',
  name: 'Performance Audit',
  systemPrompt: `You are a performance engineer auditing code for efficiency issues. Identify N+1 query patterns, unnecessary re-renders in React components, missing memoization on expensive computations, synchronous blocking in async contexts, unbounded data fetching without pagination, missing lazy loading opportunities, and O(n^2) algorithms where O(n) or O(n log n) alternatives exist. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for performance issues. Focus on algorithmic efficiency, data fetching patterns, rendering performance, and resource usage.\n\n${formatFileBlock(files)}`;
  },
};

const resiliencePrompt: AuditPromptTemplate = {
  moduleId: 'resilience',
  name: 'Resilience Audit',
  systemPrompt: `You are a site reliability engineer auditing code for resilience and fault tolerance. Identify missing retry logic for external service calls, missing timeouts on network requests, absence of circuit breaker patterns, missing graceful degradation, resource leaks (unclosed connections/streams/handles), missing health check endpoints, and operations that should be idempotent but are not. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for resilience issues. Flag missing error recovery patterns, resource leaks, missing timeouts, and operations that would fail badly under degraded conditions.\n\n${formatFileBlock(files)}`;
  },
};

const onboardingPrompt: AuditPromptTemplate = {
  moduleId: 'onboarding',
  name: 'Onboarding Quality Audit',
  systemPrompt: `You are evaluating how easy this codebase is for a new developer to understand and contribute to. Identify implicit knowledge requirements, missing setup documentation, magical conventions that aren't documented, confusing project structure, missing type definitions that force reading implementation, undocumented environment variables, and missing architecture decision records. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files from a new developer's perspective. Flag anything that would be confusing without tribal knowledge, missing documentation that blocks understanding, and patterns that aren't self-explanatory.\n\n${formatFileBlock(files)}`;
  },
};

const bestPracticesPrompt: AuditPromptTemplate = {
  moduleId: 'best-practices',
  name: 'Best Practices Audit',
  systemPrompt: `You are a senior engineer auditing code against language and framework best practices. Identify non-idiomatic patterns, deprecated API usage, anti-patterns specific to the framework in use (React, Next.js, Express, etc.), missing TypeScript strict patterns, incorrect async/await usage, and patterns that work but are considered bad practice by the community. ${JSON_OUTPUT_INSTRUCTIONS}`,
  buildUserPrompt(files) {
    return `Review the following source files for best practice violations. Flag non-idiomatic code, deprecated patterns, framework anti-patterns, and code that should use modern language features.\n\n${formatFileBlock(files)}`;
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
  errorHandlingPrompt,
  configQualityPrompt,
  apiDesignPrompt,
  loggingQualityPrompt,
  performancePrompt,
  resiliencePrompt,
  onboardingPrompt,
  bestPracticesPrompt,
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
