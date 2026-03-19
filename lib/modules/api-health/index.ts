import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';
import { detectRoutes, type DetectedRoute } from './route-detector';
import { ensureDevServer } from './server';

/** Methods that mutate data — we send an empty JSON body to test validation */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** Methods we skip by default because they are destructive */
const SKIP_METHODS = new Set(['DELETE']);

/** Response time threshold in milliseconds */
const SLOW_THRESHOLD_MS = 2000;

/** Timeout for individual endpoint requests */
const REQUEST_TIMEOUT_MS = 10_000;

/** Severity deduction map */
const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 20,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

interface EndpointTestResult {
  route: string;
  method: string;
  status: number | null;
  responseTimeMs: number;
  isJson: boolean;
  error?: string;
}

/**
 * Replace dynamic segments like :id with test-friendly placeholder values.
 * e.g. /api/scans/:id -> /api/scans/test-id
 *      /api/items/:slug* -> /api/items/test-slug
 */
function resolveTestUrl(routePath: string): string {
  return routePath
    .replace(/:(\w+)\*/g, 'test-$1')
    .replace(/:(\w+)/g, 'test-$1');
}

/**
 * Test a single endpoint and return structured results.
 */
async function testEndpoint(
  baseUrl: string,
  route: DetectedRoute,
  method: string,
): Promise<EndpointTestResult> {
  const testUrl = `${baseUrl}${resolveTestUrl(route.routePath)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const start = Date.now();
  let status: number | null = null;
  let isJson = false;
  let error: string | undefined;

  try {
    const fetchOpts: RequestInit = {
      method,
      signal: controller.signal,
      headers: {} as Record<string, string>,
    };

    if (BODY_METHODS.has(method)) {
      (fetchOpts.headers as Record<string, string>)['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify({});
    }

    const response = await fetch(testUrl, fetchOpts);
    status = response.status;

    // Check if response is JSON
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || contentType.includes('+json')) {
      isJson = true;
    } else {
      // Try to parse body as JSON anyway
      try {
        const text = await response.text();
        JSON.parse(text);
        isJson = true;
      } catch {
        isJson = false;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timeout);
  }

  const responseTimeMs = Date.now() - start;

  return {
    route: route.routePath,
    method,
    status,
    responseTimeMs,
    isJson,
    error,
  };
}

/**
 * Generate findings from a single endpoint test result.
 */
function generateEndpointFindings(
  result: EndpointTestResult,
  route: DetectedRoute,
): Finding[] {
  const findings: Finding[] = [];

  const makeFinding = (
    severity: Severity,
    message: string,
    category: string,
    suggestion: string,
  ): Finding => {
    const base = {
      severity,
      filePath: route.filePath,
      message,
      category,
      suggestion,
    };
    return {
      ...base,
      id: nanoid(),
      fingerprint: generateFingerprint('api-health', base),
    };
  };

  // Connection error (server couldn't handle request at all)
  if (result.error) {
    findings.push(
      makeFinding(
        'high',
        `${result.method} ${result.route} failed: ${result.error}`,
        'endpoint-error',
        'The endpoint threw an unhandled error or timed out. Add error handling and ensure the route returns a proper response.',
      ),
    );
    return findings;
  }

  // 500 Internal Server Error
  if (result.status !== null && result.status >= 500) {
    findings.push(
      makeFinding(
        'high',
        `${result.method} ${result.route} returned ${result.status} (server error)`,
        'server-error',
        'This endpoint crashes on basic requests. Add try/catch blocks and return proper error responses instead of letting exceptions propagate.',
      ),
    );
  }

  // POST/PUT/PATCH with empty body should return 400, not 200
  if (
    BODY_METHODS.has(result.method) &&
    result.status !== null &&
    result.status >= 200 &&
    result.status < 300
  ) {
    findings.push(
      makeFinding(
        'medium',
        `${result.method} ${result.route} accepts empty body without validation (returned ${result.status})`,
        'missing-validation',
        'Endpoints that accept a request body should validate required fields and return 400 for invalid input. Consider using zod or similar validation.',
      ),
    );
  }

  // Slow response
  if (result.responseTimeMs > SLOW_THRESHOLD_MS) {
    findings.push(
      makeFinding(
        'low',
        `${result.method} ${result.route} is slow (${result.responseTimeMs}ms, threshold: ${SLOW_THRESHOLD_MS}ms)`,
        'slow-endpoint',
        'This endpoint is slower than expected. Consider adding caching, optimizing database queries, or reducing payload size.',
      ),
    );
  }

  // Non-JSON response on API route
  if (result.status !== null && result.status < 500 && !result.isJson) {
    findings.push(
      makeFinding(
        'low',
        `${result.method} ${result.route} returned non-JSON response`,
        'non-json-response',
        'API routes should typically return JSON responses. If this is intentional (e.g., streaming or file download), this can be ignored.',
      ),
    );
  }

  return findings;
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'app', 'api'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Detecting API routes...');

    const routes = detectRoutes(repoPath);

    if (routes.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { totalRoutes: 0, totalEndpoints: 0 },
        summary: 'No API routes found in app/api/.',
      };
    }

    // Count total endpoints (route + method combinations) excluding skipped methods
    const endpoints: Array<{ route: DetectedRoute; method: string }> = [];
    for (const route of routes) {
      for (const method of route.methods) {
        if (!SKIP_METHODS.has(method)) {
          endpoints.push({ route, method });
        }
      }
    }

    opts.onProgress?.(10, `Found ${routes.length} routes (${endpoints.length} endpoints). Starting dev server...`);

    let server: { port: number; cleanup: () => void };
    try {
      server = await ensureDevServer();
    } catch (err) {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: { totalRoutes: routes.length, totalEndpoints: endpoints.length },
        summary: `Failed to start dev server: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const baseUrl = `http://localhost:${server.port}`;

    opts.onProgress?.(20, `Server ready on port ${server.port}. Testing ${endpoints.length} endpoints...`);

    const allFindings: Finding[] = [];
    const testResults: EndpointTestResult[] = [];
    let tested = 0;

    for (const { route, method } of endpoints) {
      try {
        const result = await testEndpoint(baseUrl, route, method);
        testResults.push(result);

        const endpointFindings = generateEndpointFindings(result, route);
        allFindings.push(...endpointFindings);
      } catch (err) {
        // Don't let one endpoint crash the whole module
        const errorMsg = err instanceof Error ? err.message : String(err);
        const base = {
          severity: 'high' as Severity,
          filePath: route.filePath,
          message: `${method} ${route.routePath} test crashed: ${errorMsg}`,
          category: 'test-crash',
          suggestion: 'The endpoint test itself failed unexpectedly. This may indicate a serious issue with the route.',
        };
        allFindings.push({
          ...base,
          id: nanoid(),
          fingerprint: generateFingerprint('api-health', base),
        });
      }

      tested++;
      const pct = 20 + Math.round((tested / endpoints.length) * 70);
      opts.onProgress?.(pct, `Tested ${tested}/${endpoints.length} endpoints...`);
    }

    opts.onProgress?.(95, 'Cleaning up server...');
    server.cleanup();

    // Calculate score
    let score = 100;
    for (const finding of allFindings) {
      score -= SEVERITY_DEDUCTIONS[finding.severity] ?? 0;
    }
    score = Math.max(0, score);

    // Metrics
    const metrics: Record<string, number> = {
      totalRoutes: routes.length,
      totalEndpoints: endpoints.length,
      testedEndpoints: testResults.length,
      serverErrors: testResults.filter((r) => r.status !== null && r.status >= 500).length,
      missingValidation: allFindings.filter((f) => f.category === 'missing-validation').length,
      slowEndpoints: allFindings.filter((f) => f.category === 'slow-endpoint').length,
      avgResponseTimeMs:
        testResults.length > 0
          ? Math.round(
              testResults.reduce((sum, r) => sum + r.responseTimeMs, 0) / testResults.length,
            )
          : 0,
    };

    opts.onProgress?.(100, 'API health check complete.');

    // Build summary
    const parts: string[] = [
      `Tested ${testResults.length} endpoints across ${routes.length} API routes.`,
    ];
    if (metrics.serverErrors > 0) {
      parts.push(`${metrics.serverErrors} returned server errors (5xx).`);
    }
    if (metrics.missingValidation > 0) {
      parts.push(`${metrics.missingValidation} missing input validation.`);
    }
    if (metrics.slowEndpoints > 0) {
      parts.push(`${metrics.slowEndpoints} slow responses (>${SLOW_THRESHOLD_MS}ms).`);
    }
    if (allFindings.length === 0) {
      parts.push('No issues detected.');
    }

    return {
      score,
      confidence: testResults.length > 0 ? 0.9 : 0.3,
      findings: allFindings,
      metrics,
      summary: parts.join(' '),
    };
  },
};

registerModule(
  {
    id: 'api-health',
    name: 'API Health',
    description: 'Runtime API endpoint testing for crashes, validation, and performance',
    category: 'static',
    defaultEnabled: false,
  },
  runner,
);
