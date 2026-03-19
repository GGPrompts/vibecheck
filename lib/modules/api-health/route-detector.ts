import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/** HTTP methods that Next.js API routes can export */
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;

/** Regex to detect exported HTTP method handlers in a route file */
const EXPORT_PATTERN = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g;

export interface DetectedRoute {
  /** Absolute path to the route.ts file */
  filePath: string;
  /** HTTP methods exported from this route */
  methods: string[];
  /** URL path, e.g. /api/repos or /api/scans/:id */
  routePath: string;
}

/**
 * Convert a filesystem path segment to a URL path segment.
 * Transforms Next.js dynamic segments: [id] -> :id, [...slug] -> :slug*
 */
function segmentToUrlPart(segment: string): string {
  // Catch-all: [...slug] or [[...slug]]
  const catchAll = segment.match(/^\[{1,2}\.\.\.(\w+)\]{1,2}$/);
  if (catchAll) {
    return `:${catchAll[1]}*`;
  }
  // Dynamic segment: [id]
  const dynamic = segment.match(/^\[(\w+)\]$/);
  if (dynamic) {
    return `:${dynamic[1]}`;
  }
  return segment;
}

/**
 * Convert a route file's directory path (relative to the app directory)
 * into a URL path string.
 *
 * Example: app/api/scans/[id]/progress -> /api/scans/:id/progress
 */
function filePathToRoutePath(relativeDir: string): string {
  const segments = relativeDir.split(sep).filter(Boolean);
  const urlParts = segments.map(segmentToUrlPart);
  return '/' + urlParts.join('/');
}

/**
 * Extract exported HTTP method names from a route file's source code.
 */
function extractMethods(source: string): string[] {
  const methods: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  EXPORT_PATTERN.lastIndex = 0;

  while ((match = EXPORT_PATTERN.exec(source)) !== null) {
    const method = match[1];
    if (!methods.includes(method)) {
      methods.push(method);
    }
  }

  return methods;
}

/**
 * Recursively find all route.ts files under a directory.
 */
function findRouteFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry === 'route.ts' || entry === 'route.js') {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Scan a Next.js app directory for API routes.
 *
 * Looks for route.ts/route.js files under `<repoPath>/app/api/`,
 * parses each to extract exported HTTP method handlers, and returns
 * structured route information.
 *
 * @param repoPath - Absolute path to the repository root
 * @returns Array of detected routes with their methods and URL paths
 */
export function detectRoutes(repoPath: string): DetectedRoute[] {
  const apiDir = join(repoPath, 'app', 'api');
  const appDir = join(repoPath, 'app');

  const routeFiles = findRouteFiles(apiDir);
  const routes: DetectedRoute[] = [];

  for (const filePath of routeFiles) {
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const methods = extractMethods(source);

    // Skip files with no recognized HTTP method exports
    if (methods.length === 0) {
      continue;
    }

    // Get the directory containing the route file, relative to app/
    const routeDir = relative(appDir, join(filePath, '..'));
    const routePath = filePathToRoutePath(routeDir);

    routes.push({
      filePath,
      methods,
      routePath,
    });
  }

  // Sort by route path for consistent output
  routes.sort((a, b) => a.routePath.localeCompare(b.routePath));

  return routes;
}
