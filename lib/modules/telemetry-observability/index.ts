import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';
import type { RepoTraits } from '@/lib/config/auto-detect';

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/** Structured logging libraries (presence in deps = positive signal) */
const STRUCTURED_LOG_LIBS = [
  'winston', 'pino', 'bunyan', 'log4js', 'loglevel', 'roarr',
  'signale', 'tslog', 'consola',
  // Python (detected via import scanning)
  'structlog', 'loguru',
  // Go
  'slog', 'zap', 'logrus', 'zerolog',
];

/** Monitoring / observability integrations */
const MONITORING_LIBS = [
  '@sentry/node', '@sentry/nextjs', '@sentry/react', '@sentry/browser',
  'sentry-sdk', 'newrelic', '@newrelic/next',
  'dd-trace', 'datadog-metrics',
  '@opentelemetry/api', '@opentelemetry/sdk-node', '@opentelemetry/sdk-trace-node',
  'prom-client', 'applicationinsights',
  '@google-cloud/logging', '@aws-sdk/client-cloudwatch-logs',
];

/** Health-check endpoint path patterns */
const HEALTH_ENDPOINT_PATTERNS = [
  /\/health(z)?/i,
  /\/ready(z)?/i,
  /\/live(z)?/i,
  /\/status/i,
  /\/ping/i,
];

/** Regex to detect scattered console.log / console.error usage */
const CONSOLE_LOG_RE = /\bconsole\.(log|warn|info|debug|error|trace)\s*\(/;

/** Regex to detect Python print statements used as logging */
const PYTHON_PRINT_RE = /\bprint\s*\(/;

/** Error boundary patterns */
const ERROR_BOUNDARY_PATTERNS = [
  /ErrorBoundary/,
  /componentDidCatch/,
  /error\.tsx/,
  /error\.jsx/,
  /error\.ts/,
  /error\.js/,
];

/** Try-catch in API route patterns */
const TRY_CATCH_RE = /\btry\s*\{/;

/** Source file extensions we scan */
const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.rb', '.java', '.kt',
]);

const DEFAULT_REPO_TRAITS: RepoTraits = {
  hasApiRoutes: false,
  hasFrontendBundle: false,
  hasPackageLibraryShape: false,
  hasTestSuite: false,
  hasLongRunningServer: false,
  hasDeployableService: false,
  hasCliEntrypoint: false,
  hasComplianceSignals: false,
  hasAgentToolingSignals: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectSourceFiles(repoPath: string): string[] {
  const results: string[] = [];

  try {
    // Use git ls-files for speed and to respect .gitignore
    const output = execSync('git ls-files --cached --others --exclude-standard', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && SOURCE_EXTS.has(extname(trimmed))) {
        results.push(trimmed);
      }
    }
  } catch {
    // Fallback: not a git repo or git unavailable — return empty
  }

  return results;
}

function readFileSafe(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function collectApiRouteFiles(files: string[]): string[] {
  return files.filter((f) => {
    // Next.js route handlers
    if (/\/route\.(ts|js|tsx|jsx)$/.test(f)) return true;
    // Express/Fastify pattern: routes/ or api/ directories
    if (/\/(routes|api|controllers)\//.test(f)) return true;
    return false;
  });
}

function getRepoTraits(opts: RunOptions): RepoTraits {
  return opts.autoDetect?.repoTraits ?? DEFAULT_REPO_TRAITS;
}

function getDetectedArchetype(opts: RunOptions): string | null {
  return opts.autoDetect?.detectedArchetype ?? null;
}

function isServiceLike(repoTraits: RepoTraits, archetype: string | null): boolean {
  return Boolean(
    repoTraits.hasApiRoutes
    || repoTraits.hasLongRunningServer
    || repoTraits.hasDeployableService
    || archetype === 'web-app'
    || archetype === 'api-service'
    || archetype === 'compliance-sensitive',
  );
}

function isFrontendLike(repoTraits: RepoTraits, archetype: string | null): boolean {
  return Boolean(repoTraits.hasFrontendBundle || archetype === 'web-app');
}

function isLowInfraContext(archetype: string | null): boolean {
  return archetype === 'cli' || archetype === 'library' || archetype === 'prototype';
}

function observabilityBaseline(repoTraits: RepoTraits, archetype: string | null): number {
  if (isServiceLike(repoTraits, archetype)) return 20;
  if (isFrontendLike(repoTraits, archetype)) return 35;
  if (isLowInfraContext(archetype)) return 70;
  if (archetype === 'agent-tooling') return 45;
  return 50;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    // Every project benefits from observability assessment
    return true;
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Scanning for observability patterns...');

    const repoTraits = getRepoTraits(opts);
    const archetype = getDetectedArchetype(opts);
    const serviceLike = isServiceLike(repoTraits, archetype);
    const frontendLike = isFrontendLike(repoTraits, archetype);
    const lowInfraContext = isLowInfraContext(archetype);
    const observabilityRelevant = serviceLike || frontendLike || archetype === 'agent-tooling';

    const findings: Finding[] = [];
    let score = observabilityBaseline(repoTraits, archetype);

    // Track metrics for summary
    const metrics: Record<string, number> = {
      structuredLogging: 0,
      monitoringIntegrations: 0,
      healthEndpoints: 0,
      errorBoundaries: 0,
      consoleLogFiles: 0,
      apiRoutesWithoutErrorHandling: 0,
      instrumentationFile: 0,
      ciPipeline: 0,
      totalApiRoutes: 0,
    };
    const neutralizedChecks: string[] = [];

    // ------------------------------------------------------------------
    // 1. Check package.json for structured logging & monitoring deps
    // ------------------------------------------------------------------
    opts.onProgress?.(10, 'Checking dependencies...');

    const pkgPath = join(repoPath, 'package.json');
    let allDeps: Record<string, string> = {};
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSafe(pkgPath));
        allDeps = {
          ...(pkg.dependencies ?? {}),
          ...(pkg.devDependencies ?? {}),
        };
      } catch {
        // Malformed package.json
      }
    }

    // Also check go.mod, requirements.txt, Cargo.toml for non-JS projects
    const goModPath = join(repoPath, 'go.mod');
    const requirementsPath = join(repoPath, 'requirements.txt');
    let goModContent = '';
    let requirementsContent = '';
    if (existsSync(goModPath)) goModContent = readFileSafe(goModPath);
    if (existsSync(requirementsPath)) requirementsContent = readFileSafe(requirementsPath);

    const foundLogLibs: string[] = [];
    for (const lib of STRUCTURED_LOG_LIBS) {
      if (
        allDeps[lib] ||
        goModContent.includes(lib) ||
        requirementsContent.includes(lib)
      ) {
        foundLogLibs.push(lib);
      }
    }

    if (foundLogLibs.length > 0) {
      score += 20;
      metrics.structuredLogging = foundLogLibs.length;
      findings.push(makeFinding(
        'info',
        'package.json',
        `Structured logging detected: ${foundLogLibs.join(', ')}`,
        'structured-logging',
      ));
    } else if (observabilityRelevant) {
      findings.push(makeFinding(
        serviceLike ? 'medium' : 'low',
        'package.json',
        serviceLike
          ? 'No structured logging library found. This matters for a deployable service because console output disappears once the process crashes or scales out.'
          : frontendLike
            ? 'No structured logging library found. This still matters for a frontend or hybrid app because structured logs are easier to correlate with user-visible failures.'
            : 'No structured logging library found. This matters for unattended agent/tooling workflows because plain console output is hard to correlate after the fact.',
        'structured-logging',
        'Add a structured logger like pino or winston so logs stay searchable when this repo runs unattended or is deployed.',
      ));
    }

    const foundMonitoring: string[] = [];
    for (const lib of MONITORING_LIBS) {
      if (
        allDeps[lib] ||
        goModContent.includes(lib) ||
        requirementsContent.includes(lib)
      ) {
        foundMonitoring.push(lib);
      }
    }

    if (foundMonitoring.length > 0) {
      score += 20;
      metrics.monitoringIntegrations = foundMonitoring.length;
      findings.push(makeFinding(
        'info',
        'package.json',
        `Monitoring integrations detected: ${foundMonitoring.join(', ')}`,
        'monitoring',
      ));
    } else if (serviceLike || frontendLike || archetype === 'agent-tooling') {
      findings.push(makeFinding(
        'medium',
        'package.json',
        serviceLike
          ? 'No monitoring or error tracking integration found (Sentry, DataDog, OpenTelemetry, etc.). This matters because deployable services need a way to see runtime failures after the process exits.'
          : 'No monitoring or error tracking integration found. This matters because user-facing apps and agent tooling benefit from crash and performance visibility when something fails outside the terminal.',
        'monitoring',
        serviceLike
          ? 'Add an error tracking service like Sentry or OpenTelemetry so runtime errors and latency regressions are observable outside the local console.'
          : 'Add an error tracking service if this repo runs as a user-facing app or agent runtime; it makes failures diagnosable after the command returns.',
      ));
    } else {
      neutralizedChecks.push('monitoring');
    }

    // ------------------------------------------------------------------
    // 2. Scan source files
    // ------------------------------------------------------------------
    opts.onProgress?.(30, 'Scanning source files...');

    const sourceFiles = collectSourceFiles(repoPath);
    const apiRouteFiles = collectApiRouteFiles(sourceFiles);
    metrics.totalApiRoutes = apiRouteFiles.length;

    // Track console.log scatter
    let consoleLogCount = 0;
    const consoleLogSampleFiles: string[] = [];

    // Track error boundaries
    let hasErrorBoundary = false;

    // Track health endpoints
    let healthEndpointCount = 0;

    for (const relFile of sourceFiles) {
      if (opts.signal?.aborted) break;

      const absPath = join(repoPath, relFile);
      const content = readFileSafe(absPath);
      if (!content) continue;

      // Count console.log usage
      const ext = extname(relFile);
      const isJSish = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
      const isPython = ext === '.py';

      if (isJSish && CONSOLE_LOG_RE.test(content)) {
        consoleLogCount++;
        if (consoleLogSampleFiles.length < 5) {
          consoleLogSampleFiles.push(relFile);
        }
      } else if (isPython && PYTHON_PRINT_RE.test(content)) {
        consoleLogCount++;
        if (consoleLogSampleFiles.length < 5) {
          consoleLogSampleFiles.push(relFile);
        }
      }

      // Check for error boundaries
      for (const pattern of ERROR_BOUNDARY_PATTERNS) {
        if (pattern.test(relFile) || pattern.test(content)) {
          hasErrorBoundary = true;
          break;
        }
      }

      // Check for health endpoint definitions
      for (const pattern of HEALTH_ENDPOINT_PATTERNS) {
        if (pattern.test(content)) {
          healthEndpointCount++;
          break; // Count file once
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Console.log scatter analysis
    // ------------------------------------------------------------------
    metrics.consoleLogFiles = consoleLogCount;

    if (consoleLogCount === 0) {
      score += 10;
    } else if (consoleLogCount <= 3) {
      score += 5;
      findings.push(makeFinding(
        'low',
        consoleLogSampleFiles[0] ?? '.',
        `Found console.log/print in ${consoleLogCount} file(s). Minor scatter.`,
        'console-scatter',
        'Consider replacing console.log calls with a structured logger for better filtering and log levels.',
      ));
    } else {
      // Heavy console.log scatter is a negative signal
      findings.push(makeFinding(
        'medium',
        consoleLogSampleFiles[0] ?? '.',
        `Found console.log/print in ${consoleLogCount} file(s): ${consoleLogSampleFiles.join(', ')}${consoleLogCount > 5 ? ` and ${consoleLogCount - 5} more` : ''}`,
        'console-scatter',
        `Replace scattered console.log calls with a structured logger. ${consoleLogCount} files with unstructured logging makes debugging harder for both humans and AI agents.`,
      ));
    }

    // ------------------------------------------------------------------
    // 4. Error boundaries / crash handlers
    // ------------------------------------------------------------------
    if (hasErrorBoundary) {
      score += 10;
      metrics.errorBoundaries = 1;
      findings.push(makeFinding(
        'info',
        '.',
        'Error boundary or crash handler detected.',
        'error-boundary',
      ));
    } else if (frontendLike) {
      findings.push(makeFinding(
        'low',
        '.',
        'No error boundaries or global crash handlers found. This matters for a React or hybrid frontend because it keeps UI crashes from taking down the whole experience.',
        'error-boundary',
        'Add React ErrorBoundary components or global error handlers to keep UI failures contained and easier to diagnose.',
      ));
    } else {
      neutralizedChecks.push('error-boundary');
    }

    // ------------------------------------------------------------------
    // 5. Health check endpoints
    // ------------------------------------------------------------------
    if (healthEndpointCount > 0) {
      score += 15;
      metrics.healthEndpoints = healthEndpointCount;
      findings.push(makeFinding(
        'info',
        '.',
        `Found ${healthEndpointCount} file(s) with health/readiness endpoint patterns.`,
        'health-endpoint',
      ));
    } else if (serviceLike) {
      findings.push(makeFinding(
        'medium',
        '.',
        'No health check endpoints (/health, /ready, /ping) detected. This matters for deployable services because load balancers, uptime checks, and on-call workflows depend on a quick readiness signal.',
        'health-endpoint',
        'Add a /health endpoint so uptime monitoring and deployment probes can tell whether the service is alive.',
      ));
    } else {
      neutralizedChecks.push('health-endpoint');
    }

    // ------------------------------------------------------------------
    // 6. API route error handling
    // ------------------------------------------------------------------
    opts.onProgress?.(60, 'Checking API route error handling...');

    let apiRoutesWithoutTryCatch = 0;
    const unhandledRoutes: string[] = [];

    for (const relFile of apiRouteFiles) {
      const absPath = join(repoPath, relFile);
      const content = readFileSafe(absPath);
      if (!content) continue;

      if (!TRY_CATCH_RE.test(content)) {
        apiRoutesWithoutTryCatch++;
        if (unhandledRoutes.length < 5) {
          unhandledRoutes.push(relFile);
        }
      }
    }

    metrics.apiRoutesWithoutErrorHandling = apiRoutesWithoutTryCatch;

    if (apiRouteFiles.length > 0) {
      if (apiRoutesWithoutTryCatch === 0) {
        score += 10;
      } else {
        const pct = Math.round((apiRoutesWithoutTryCatch / apiRouteFiles.length) * 100);
        findings.push(makeFinding(
          apiRoutesWithoutTryCatch > apiRouteFiles.length / 2 ? 'high' : 'medium',
          unhandledRoutes[0] ?? '.',
          `${apiRoutesWithoutTryCatch} of ${apiRouteFiles.length} API route(s) lack try/catch error handling (${pct}%). This matters because API routes are part of the runtime surface and should fail predictably.`,
          'api-error-handling',
          `Wrap the ${apiRoutesWithoutTryCatch} route handler(s) in try/catch so failures stay observable and return structured errors instead of crashing.`,
        ));
      }
    }

    // ------------------------------------------------------------------
    // 7. Next.js instrumentation.ts
    // ------------------------------------------------------------------
    opts.onProgress?.(75, 'Checking instrumentation and CI...');

    const instrumentationPaths = [
      'instrumentation.ts', 'instrumentation.js',
      'src/instrumentation.ts', 'src/instrumentation.js',
    ];
    const hasInstrumentation = instrumentationPaths.some((p) =>
      existsSync(join(repoPath, p))
    );

    if (hasInstrumentation) {
      score += 5;
      metrics.instrumentationFile = 1;
      findings.push(makeFinding(
        'info',
        'instrumentation.ts',
        'Next.js instrumentation file detected — enables server-side tracing and monitoring hooks.',
        'instrumentation',
      ));
    }

    // ------------------------------------------------------------------
    // 8. CI pipeline visibility
    // ------------------------------------------------------------------
    const ciPaths = [
      '.github/workflows',
      '.gitlab-ci.yml',
      'Jenkinsfile',
      '.circleci/config.yml',
      '.travis.yml',
      'bitbucket-pipelines.yml',
      'azure-pipelines.yml',
    ];
    const hasCi = ciPaths.some((p) => existsSync(join(repoPath, p)));

    if (hasCi) {
      score += 10;
      metrics.ciPipeline = 1;
      findings.push(makeFinding(
        'info',
        '.',
        'CI/CD pipeline configuration detected — enables automated visibility into build and test results.',
        'ci-pipeline',
      ));
    } else if (serviceLike || frontendLike || archetype === 'agent-tooling') {
      findings.push(makeFinding(
        'low',
        '.',
        'No CI/CD pipeline configuration found. This matters here because deployable services and frontends need automated checks before changes reach users.',
        'ci-pipeline',
        'Add a CI pipeline (GitHub Actions, GitLab CI, etc.) to get automated feedback on every push.',
      ));
    } else {
      neutralizedChecks.push('ci-pipeline');
    }

    // ------------------------------------------------------------------
    // Clamp score
    // ------------------------------------------------------------------
    score = Math.max(0, Math.min(100, score));

    // ------------------------------------------------------------------
    // Feedback loop rating
    // ------------------------------------------------------------------
    opts.onProgress?.(90, 'Computing feedback loop rating...');

    let feedbackRating: string;
    if (score >= 80) {
      feedbackRating = 'High — AI agents can work with strong observability signals';
    } else if (score >= 50) {
      feedbackRating = 'Moderate — AI agents can partially self-diagnose issues';
    } else if (score >= 25) {
      feedbackRating = 'Low — AI agents will struggle to diagnose runtime issues';
    } else {
      feedbackRating = 'Minimal — AI agents are essentially flying blind';
    }

    findings.push(makeFinding(
      score >= 50 ? 'info' : 'medium',
      '.',
      `Feedback loop rating: ${feedbackRating} (score: ${score}/100)`,
      'feedback-loop',
      score < 50
        ? buildImprovementSuggestion(metrics, score)
        : undefined,
    ));

    // ------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------
    opts.onProgress?.(100, 'Observability scan complete.');

    const positives: string[] = [];
    if (metrics.structuredLogging > 0) positives.push('structured logging');
    if (metrics.monitoringIntegrations > 0) positives.push('monitoring');
    if (metrics.healthEndpoints > 0) positives.push('health checks');
    if (metrics.errorBoundaries > 0) positives.push('error boundaries');
    if (metrics.ciPipeline > 0) positives.push('CI pipeline');
    if (metrics.instrumentationFile > 0) positives.push('instrumentation');

    const contextParts = [
      serviceLike ? 'service-like' : null,
      frontendLike ? 'frontend-like' : null,
      lowInfraContext ? 'low-infra' : null,
      archetype === 'agent-tooling' ? 'agent-tooling' : null,
    ].filter(Boolean);
    const contextSuffix = contextParts.length > 0 ? ` Repo shape: ${contextParts.join(', ')}.` : '';
    const neutralizedSuffix = neutralizedChecks.length > 0
      ? ` Neutralized checks: ${neutralizedChecks.join(', ')}.`
      : '';

    const summary = positives.length > 0
      ? `Observability score ${score}/100. Detected: ${positives.join(', ')}.${contextSuffix}${neutralizedSuffix} ${feedbackRating}.`
      : `Observability score ${score}/100. No observability infrastructure detected.${contextSuffix}${neutralizedSuffix} ${feedbackRating}.`;

    return {
      score,
      confidence: 0.85,
      findings,
      metrics,
      summary,
    };
  },
};

// ---------------------------------------------------------------------------
// Finding factory
// ---------------------------------------------------------------------------

function makeFinding(
  severity: Severity,
  filePath: string,
  message: string,
  category: string,
  suggestion?: string,
): Finding {
  const base = { severity, filePath, message, category, suggestion };
  return {
    ...base,
    id: nanoid(),
    fingerprint: generateFingerprint('telemetry-observability', base),
  };
}

// ---------------------------------------------------------------------------
// Improvement suggestion builder
// ---------------------------------------------------------------------------

function buildImprovementSuggestion(metrics: Record<string, number>, currentScore: number): string {
  const suggestions: string[] = [];
  let projectedGain = 0;

  if (metrics.structuredLogging === 0) {
    suggestions.push('adding a structured logger (pino/winston) [+20]');
    projectedGain += 20;
  }
  if (metrics.monitoringIntegrations === 0) {
    suggestions.push('adding error tracking (Sentry/OpenTelemetry) [+20]');
    projectedGain += 20;
  }
  if (metrics.healthEndpoints === 0) {
    suggestions.push('adding a /health endpoint [+15]');
    projectedGain += 15;
  }
  if (metrics.ciPipeline === 0) {
    suggestions.push('adding CI/CD pipeline [+10]');
    projectedGain += 10;
  }

  const projected = Math.min(100, currentScore + projectedGain);

  if (suggestions.length === 0) return '';

  return `${suggestions.join(', ')} would raise observability from ${currentScore} to ~${projected}.`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerModule(
  {
    id: 'telemetry-observability',
    name: 'Telemetry & Observability',
    description: 'Scores project debuggability: structured logging, monitoring, health checks, error handling, and CI visibility',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
