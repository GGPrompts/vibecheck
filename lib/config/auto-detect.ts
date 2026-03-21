/**
 * Zero-config auto-detection layer.
 *
 * Runs before every scan to infer sensible defaults from the repo structure.
 * Produces an in-memory config overlay that is the LOWEST priority layer:
 *
 *   auto-detect -> profile defaults -> .vibecheckrc -> explicit overrides
 *
 * No AI tokens consumed, no network calls -- pure static file system inspection.
 */

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, posix, sep } from 'path';
import type { VibecheckRc } from './vibecheckrc';
import type { ProjectProfile } from './profiles';

// ── Types ──────────────────────────────────────────────────────────────

export interface AutoDetectResult {
  /** Knip entry points derived from package.json and directory patterns. */
  knipEntryPoints: string[];

  /** Knip ignore patterns for directories that should not be flagged. */
  knipIgnorePatterns: string[];

  /** File roles that should suppress "unused file" dead-code warnings. */
  deadCodeExemptRoles: Set<string>;

  /** Suggested project profile based on git contributor count. */
  suggestedProfile: ProjectProfile | null;

  /** Detected framework name (for logging/debugging). */
  detectedFramework: string | null;

  /** Config overlay to merge as the lowest-priority layer. */
  configOverlay: VibecheckRc;
}

// ── Entrypoint directory patterns ──────────────────────────────────────

/** Directories whose files are always entrypoints (not dead code). */
const ENTRYPOINT_DIRS = [
  'bin',
  'cli',
  'scripts',
  'mcp-server',
  'workers',
  'worker',
] as const;

// ── Framework detection ────────────────────────────────────────────────

interface FrameworkDef {
  name: string;
  /** Check: file exists at repo root. */
  configFiles?: string[];
  /** Check: dependency present in package.json. */
  dependency?: string;
  /** Thresholds to relax for this framework. */
  thresholds?: Record<string, number>;
  /** Additional knip entry patterns. */
  entryPatterns?: string[];
}

const FRAMEWORK_DEFS: FrameworkDef[] = [
  {
    name: 'nextjs',
    configFiles: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    dependency: 'next',
    thresholds: {
      // Next.js app router files can be larger due to metadata exports, layouts, etc.
      'complexity-loc': 600,
    },
    entryPatterns: ['app/**/*.{ts,tsx}', 'pages/**/*.{ts,tsx,js,jsx}'],
  },
  {
    name: 'express',
    dependency: 'express',
    thresholds: {
      // Express route handlers can legitimately have higher complexity
      'complexity-cyclomatic': 15,
    },
  },
  {
    name: 'fastify',
    dependency: 'fastify',
    thresholds: {
      'complexity-cyclomatic': 15,
    },
  },
  {
    name: 'hono',
    dependency: 'hono',
    thresholds: {},
  },
  {
    name: 'remix',
    configFiles: ['remix.config.js', 'remix.config.ts'],
    dependency: '@remix-run/node',
    thresholds: {
      'complexity-loc': 600,
    },
    entryPatterns: ['app/**/*.{ts,tsx}'],
  },
  {
    name: 'nuxt',
    configFiles: ['nuxt.config.ts', 'nuxt.config.js'],
    dependency: 'nuxt',
    thresholds: {
      'complexity-loc': 600,
    },
    entryPatterns: ['pages/**/*.vue', 'server/**/*.ts'],
  },
  {
    name: 'vite',
    configFiles: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
    dependency: 'vite',
    thresholds: {},
  },
  {
    name: 'electron',
    dependency: 'electron',
    thresholds: {
      'complexity-loc': 800,
    },
    entryPatterns: ['main/**/*.{ts,js}', 'preload/**/*.{ts,js}'],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join(posix.sep);
}

/**
 * Safely read and parse package.json from the repo root.
 * Returns null if not found or invalid.
 */
function readPackageJson(repoPath: string): Record<string, unknown> | null {
  const pkgPath = join(repoPath, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Extract knip entry points from package.json fields:
 *   - bin (string or object)
 *   - main
 *   - exports (string, object with . key, or nested conditions)
 *   - module
 *   - source
 */
function extractPackageEntryPoints(pkg: Record<string, unknown>): string[] {
  const entries: string[] = [];

  // bin
  if (typeof pkg.bin === 'string') {
    entries.push(pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) {
    for (const val of Object.values(pkg.bin as Record<string, unknown>)) {
      if (typeof val === 'string') entries.push(val);
    }
  }

  // main
  if (typeof pkg.main === 'string') entries.push(pkg.main);

  // module
  if (typeof pkg.module === 'string') entries.push(pkg.module);

  // source
  if (typeof pkg.source === 'string') entries.push(pkg.source);

  // exports
  if (pkg.exports) {
    extractExportsEntries(pkg.exports, entries);
  }

  // Normalise: strip leading ./ and deduplicate
  const normalised = new Set(
    entries
      .map((e) => toPosix(e).replace(/^\.\//, ''))
      .filter((e) => e.length > 0 && !e.startsWith('node_modules')),
  );
  return Array.from(normalised);
}

/**
 * Recursively extract file paths from the package.json `exports` field.
 * Handles:
 *   - string: "./dist/index.js"
 *   - object with condition keys: { "import": "./dist/index.mjs", "require": "./dist/index.cjs" }
 *   - nested objects: { ".": { "import": "..." }, "./sub": "..." }
 */
function extractExportsEntries(exports: unknown, entries: string[]): void {
  if (typeof exports === 'string') {
    entries.push(exports);
  } else if (Array.isArray(exports)) {
    for (const item of exports) {
      extractExportsEntries(item, entries);
    }
  } else if (exports && typeof exports === 'object') {
    for (const val of Object.values(exports as Record<string, unknown>)) {
      extractExportsEntries(val, entries);
    }
  }
}

/**
 * Detect entrypoint directories that exist in the repo and generate glob patterns.
 */
function detectEntrypointDirPatterns(repoPath: string): string[] {
  const patterns: string[] = [];
  for (const dir of ENTRYPOINT_DIRS) {
    const dirPath = join(repoPath, dir);
    if (existsSync(dirPath)) {
      patterns.push(`${dir}/**/*.{ts,tsx,js,jsx,mjs,cjs}`);
    }
  }
  return patterns;
}

/**
 * Detect framework from config files and package.json dependencies.
 * Returns the first match (most specific frameworks are listed first).
 */
function detectFramework(
  repoPath: string,
  pkg: Record<string, unknown> | null,
): FrameworkDef | null {
  if (!pkg) return null;

  const deps = {
    ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null
      ? pkg.dependencies
      : {}),
    ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null
      ? pkg.devDependencies
      : {}),
  } as Record<string, unknown>;

  for (const fw of FRAMEWORK_DEFS) {
    // Check config files first (more specific)
    if (fw.configFiles) {
      const hasConfig = fw.configFiles.some((f) => existsSync(join(repoPath, f)));
      if (hasConfig) return fw;
    }
    // Check dependency
    if (fw.dependency && fw.dependency in deps) {
      return fw;
    }
  }

  return null;
}

/**
 * Count unique git contributors in the last 6 months.
 * Returns 0 if git is unavailable or the repo is not a git repo.
 */
function countGitContributors(repoPath: string): number {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const since = sixMonthsAgo.toISOString().slice(0, 10);

    const stdout = execSync(
      `git log --since="${since}" --format="%ae" | sort -u | wc -l`,
      {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const count = parseInt(stdout.trim(), 10);
    return isNaN(count) ? 0 : count;
  } catch {
    return 0;
  }
}

/**
 * Suggest a project profile based on contributor count.
 * Returns null if we cannot determine (let the user or profile system decide).
 */
function suggestProfile(contributorCount: number): ProjectProfile | null {
  if (contributorCount === 0) return null; // can't determine
  if (contributorCount === 1) return 'solo';
  if (contributorCount <= 4) return 'team';
  // 5+ contributors suggests a larger team, but "team" is still appropriate
  // Enterprise requires explicit opt-in (compliance, etc.)
  return 'team';
}

// ── Main ───────────────────────────────────────────────────────────────

/**
 * Run zero-config auto-detection on a repository.
 *
 * Inspects package.json, directory structure, git history, and framework
 * markers to produce a config overlay. This overlay is the lowest-priority
 * layer and will be overridden by profile defaults, .vibecheckrc, and
 * explicit scan config.
 *
 * @param repoPath Absolute path to the repository root.
 * @returns AutoDetectResult with the config overlay and metadata.
 */
export function autoDetect(repoPath: string): AutoDetectResult {
  const pkg = readPackageJson(repoPath);

  // 1. Generate knip entry points from package.json
  const pkgEntryPoints = pkg ? extractPackageEntryPoints(pkg) : [];

  // 2. Detect common entrypoint directories
  const dirPatterns = detectEntrypointDirPatterns(repoPath);

  // 3. Detect framework and get additional entry patterns + threshold adjustments
  const framework = detectFramework(repoPath, pkg);
  const frameworkEntryPatterns = framework?.entryPatterns ?? [];

  // Combine all entry points (deduplicated)
  const knipEntryPoints = Array.from(
    new Set([...pkgEntryPoints, ...dirPatterns, ...frameworkEntryPatterns]),
  );

  // Standard ignore patterns for knip
  const knipIgnorePatterns = [
    'lib/db/migrations/**',
    'components/ui/**',
  ];

  // 4. File roles that should exempt files from "unused file" dead-code warnings
  const deadCodeExemptRoles = new Set([
    'cli-entrypoint',
    'mcp-tool',
    'provider',
    'api-route',
  ]);

  // 5. Count git contributors and suggest profile
  const contributorCount = countGitContributors(repoPath);
  const suggestedProfileValue = suggestProfile(contributorCount);

  // 6. Build the config overlay
  const configOverlay: VibecheckRc = {};

  // Only suggest a profile -- don't override if already set
  if (suggestedProfileValue) {
    configOverlay.profile = suggestedProfileValue;
  }

  // Apply framework-specific threshold adjustments
  if (framework?.thresholds && Object.keys(framework.thresholds).length > 0) {
    configOverlay.thresholds = { ...framework.thresholds };
  }

  return {
    knipEntryPoints,
    knipIgnorePatterns,
    deadCodeExemptRoles,
    suggestedProfile: suggestedProfileValue,
    detectedFramework: framework?.name ?? null,
    configOverlay,
  };
}
