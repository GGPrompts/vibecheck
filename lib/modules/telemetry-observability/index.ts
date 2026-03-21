import { readFileSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectSourceFiles(repoPath: string): string[] {
  const results: string[] = [];
  const { execSync } = require('child_process');

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

    const findings: Finding[] = [];
    let score = 0; // Start at 0, add points for positive signals

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
    } else {
      findings.push(makeFinding(
        'medium',
        'package.json',
        'No structured logging library found. Console.log is not a logging strategy.',
        'structured-logging',
        'Add a structured logger like pino or winston. Structured JSON logs are parseable by monitoring tools and AI agents.',
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
    } else {
      findings.push(makeFinding(
        'medium',
        'package.json',
        'No monitoring or error tracking integration found (Sentry, DataDog, OpenTelemetry, etc.).',
        'monitoring',
        'Add an error tracking service like Sentry or OpenTelemetry to capture runtime errors and performance data.',
      ));
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
    } else {
      findings.push(makeFinding(
        'low',
        '.',
        'No error boundaries or global crash handlers found.',
        'error-boundary',
        'Add React ErrorBoundary components or global error handlers (process.on("uncaughtException")) to prevent silent failures.',
      ));
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
    } else {
      findings.push(makeFinding(
        'medium',
        '.',
        'No health check endpoints (/health, /ready, /ping) detected.',
        'health-endpoint',
        'Add a /health endpoint that returns service status. This enables uptime monitoring, load balancer checks, and AI agent self-diagnosis.',
      ));
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
          `${apiRoutesWithoutTryCatch} of ${apiRouteFiles.length} API route(s) lack try/catch error handling (${pct}%).`,
          'api-error-handling',
          `Adding structured error logging to your ${apiRoutesWithoutTryCatch} unhandled API route handler(s) would significantly improve observability.`,
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
    } else {
      findings.push(makeFinding(
        'low',
        '.',
        'No CI/CD pipeline configuration found.',
        'ci-pipeline',
        'Add a CI pipeline (GitHub Actions, GitLab CI, etc.) to get automated feedback on every push.',
      ));
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

    const summary = positives.length > 0
      ? `Observability score ${score}/100. Detected: ${positives.join(', ')}. ${feedbackRating}.`
      : `Observability score ${score}/100. No observability infrastructure detected. ${feedbackRating}.`;

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
