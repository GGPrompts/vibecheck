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
import { type ProjectProfile, normalizeProjectProfile } from './profiles';

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

  /** Repo archetype inferred from repo shape and package/layout signals. */
  detectedArchetype: ProjectProfile | null;

  /** High-level repo traits used for module applicability decisions. */
  repoTraits: RepoTraits;

  /** Detected framework name (for logging/debugging). */
  detectedFramework: string | null;

  /** Config overlay to merge as the lowest-priority layer. */
  configOverlay: VibecheckRc;
}

export interface RepoTraits {
  hasApiRoutes: boolean;
  hasFrontendBundle: boolean;
  hasPackageLibraryShape: boolean;
  hasTestSuite: boolean;
  hasLongRunningServer: boolean;
  hasDeployableService: boolean;
  hasCliEntrypoint: boolean;
  hasComplianceSignals: boolean;
  hasAgentToolingSignals: boolean;
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

const TRAIT_PATHS = {
  apiRoutes: ['app/api', 'pages/api', 'server/api', 'src/server/api'],
  frontendBundle: ['app', 'pages', 'components', 'src/components', 'public'],
  packageLibrary: ['src', 'lib'],
  testSuite: ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'integration'],
  longRunningServer: ['server', 'src/server', 'app/server'],
  cliEntrypoint: ['bin', 'cli', 'scripts'],
  complianceSignals: [
    'compliance',
    'security',
    'audit',
    'policy',
    'hipaa',
    'gdpr',
    'soc2',
    'privacy',
  ],
  agentToolingSignals: [
    'mcp-server',
    'prompts',
    'prompt',
    'agents',
    'playbooks',
    '.codex-plugin',
  ],
} as const;

const DEPLOYMENT_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'vercel.json',
  'fly.toml',
  'render.yaml',
  'railway.toml',
  'Procfile',
] as const;

function pathExists(repoPath: string, relativePath: string): boolean {
  return existsSync(join(repoPath, relativePath));
}

function anyPathExists(repoPath: string, paths: readonly string[]): boolean {
  return paths.some((p) => pathExists(repoPath, p));
}

function getPackageScripts(
  pkg: Record<string, unknown> | null,
): Record<string, string> {
  if (!pkg || typeof pkg.scripts !== 'object' || pkg.scripts === null || Array.isArray(pkg.scripts)) {
    return {};
  }
  const scripts: Record<string, string> = {};
  for (const [key, value] of Object.entries(pkg.scripts as Record<string, unknown>)) {
    if (typeof value === 'string') scripts[key] = value;
  }
  return scripts;
}

function scriptMatches(scripts: Record<string, string>, names: string[], pattern: RegExp): boolean {
  return names.some((name) => pattern.test(scripts[name] ?? ''));
}

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

function detectRepoTraits(repoPath: string, pkg: Record<string, unknown> | null, framework: FrameworkDef | null): RepoTraits {
  const scripts = getPackageScripts(pkg);

  const hasApiRoutes = anyPathExists(repoPath, TRAIT_PATHS.apiRoutes);
  const hasFrontendBundle = anyPathExists(repoPath, TRAIT_PATHS.frontendBundle)
    || framework?.name === 'nextjs'
    || framework?.name === 'remix'
    || framework?.name === 'nuxt'
    || framework?.name === 'vite';
  const hasPackageLibraryShape = Boolean(
    pkg && (
      typeof pkg.exports === 'object'
      || typeof pkg.exports === 'string'
      || typeof pkg.main === 'string'
      || typeof pkg.module === 'string'
      || typeof pkg.source === 'string'
    ),
  );
  const hasTestSuite = anyPathExists(repoPath, TRAIT_PATHS.testSuite)
    || scriptMatches(scripts, ['test', 'test:ci', 'coverage', 'check'], /(vitest|jest|playwright|cypress|coverage|test)/i);
  const hasLongRunningServer = anyPathExists(repoPath, TRAIT_PATHS.longRunningServer)
    || scriptMatches(scripts, ['start', 'serve', 'dev'], /(node|tsx|ts-node|nodemon|next|nuxt|vite|express|fastify|hono|webpack)/i);
  const hasDeployableService = hasApiRoutes
    || hasLongRunningServer
    || anyPathExists(repoPath, DEPLOYMENT_FILES);
  const hasCliEntrypoint = Boolean(
    anyPathExists(repoPath, TRAIT_PATHS.cliEntrypoint)
    || typeof pkg?.bin === 'string'
    || (pkg?.bin && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)),
  );
  const hasComplianceSignals = anyPathExists(repoPath, TRAIT_PATHS.complianceSignals)
    || Boolean(
      pkg
      && typeof pkg.name === 'string'
      && /(compliance|security|audit|policy|hipaa|gdpr|soc2|privacy)/i.test(pkg.name),
    );
  const hasAgentToolingSignals = anyPathExists(repoPath, TRAIT_PATHS.agentToolingSignals)
    || anyPathExists(repoPath, ['mcp-server', 'app/api/mcp', 'src/mcp']);

  return {
    hasApiRoutes,
    hasFrontendBundle,
    hasPackageLibraryShape,
    hasTestSuite,
    hasLongRunningServer,
    hasDeployableService,
    hasCliEntrypoint,
    hasComplianceSignals,
    hasAgentToolingSignals,
  };
}

function detectArchetype(
  framework: FrameworkDef | null,
  traits: RepoTraits,
  contributorCount: number,
): ProjectProfile {
  if (traits.hasComplianceSignals) return 'compliance-sensitive';
  if (traits.hasAgentToolingSignals) return 'agent-tooling';
  if (traits.hasCliEntrypoint && !traits.hasFrontendBundle && !traits.hasApiRoutes) return 'cli';
  if (
    traits.hasPackageLibraryShape
    && !traits.hasFrontendBundle
    && !traits.hasApiRoutes
    && !traits.hasLongRunningServer
    && !traits.hasCliEntrypoint
  ) {
    return 'library';
  }
  if (framework?.name === 'nextjs' || framework?.name === 'remix' || framework?.name === 'nuxt') {
    return 'web-app';
  }
  if (framework?.name === 'express' || framework?.name === 'fastify' || framework?.name === 'hono') {
    return 'api-service';
  }
  if (traits.hasApiRoutes || traits.hasDeployableService || traits.hasLongRunningServer) {
    return traits.hasFrontendBundle ? 'web-app' : 'api-service';
  }
  if (traits.hasFrontendBundle) return 'web-app';

  // Tiny repos with no strong service/library signals default to prototype.
  if (contributorCount <= 1) return 'prototype';

  return 'prototype';
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
 * Suggest a fallback archetype based on contributor count.
 * Returns null if we cannot determine (let the user or repo-shape detection decide).
 */
function suggestProfile(contributorCount: number): ProjectProfile | null {
  if (contributorCount === 0) return null; // can't determine
  if (contributorCount === 1) return 'prototype';
  return 'web-app';
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

  const repoTraits = detectRepoTraits(repoPath, pkg, framework);
  const contributorCount = countGitContributors(repoPath);
  const detectedArchetype = detectArchetype(framework, repoTraits, contributorCount);

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

  // 5. Count git contributors and keep the old signal around as a tie-breaker.
  const suggestedProfileValue = suggestProfile(contributorCount);

  // 6. Build the config overlay
  const configOverlay: VibecheckRc = {};

  // The archetype is the lowest-priority profile hint; explicit config wins.
  if (detectedArchetype) {
    configOverlay.profile = detectedArchetype;
  } else if (suggestedProfileValue) {
    configOverlay.profile = normalizeProjectProfile(suggestedProfileValue) ?? suggestedProfileValue;
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
    detectedArchetype,
    repoTraits,
    detectedFramework: framework?.name ?? null,
    configOverlay,
  };
}
