import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { basename, join, resolve } from 'path';
import { homedir } from 'os';

interface DiscoveredRepo {
  /** Absolute path to the repository directory */
  path: string;
  /** Display name (from package.json name, or directory basename) */
  name: string;
  /** ISO 8601 date string of the last git commit, or null if not a git repo */
  lastCommitDate: string | null;
  /** Whether the directory contains a .git folder */
  hasGit: boolean;
}

/** Directories to skip during recursive walk */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
]);

/**
 * Check if a directory name should be skipped.
 * Skips node_modules, .git, dist, build, and any hidden directory (starting with .).
 */
function shouldSkip(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name);
}

/**
 * Determine whether a directory qualifies as a "repo" —
 * it has a `.git/` subdirectory OR a `package.json` file.
 */
function isRepo(dirPath: string): boolean {
  return (
    existsSync(join(dirPath, '.git')) ||
    existsSync(join(dirPath, 'package.json'))
  );
}

/**
 * Extract a human-readable name for a repo.
 * Prefers the `name` field from `package.json`; falls back to the directory basename.
 */
function extractName(dirPath: string): string {
  const pkgPath = join(dirPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        return pkg.name;
      }
    } catch {
      // fall back to directory name
    }
  }
  return basename(dirPath);
}

/**
 * Get the last commit date (ISO 8601) from a git repository.
 * Returns null if the directory is not a git repo or if the command fails.
 */
function getLastCommitDate(dirPath: string): string | null {
  if (!existsSync(join(dirPath, '.git'))) {
    return null;
  }

  try {
    const output = execSync('git log -1 --format=%cI', {
      cwd: dirPath,
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const trimmed = output.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * Recursively walk directories up to `maxDepth`, collecting repos.
 * Once a directory is identified as a repo it is collected and we stop
 * descending into it (repos are not expected to nest).
 */
function walkForRepos(
  dir: string,
  depth: number,
  maxDepth: number,
  results: DiscoveredRepo[],
): void {
  if (depth > maxDepth) return;

  // If this directory is itself a repo, collect it and stop descending
  if (depth > 0 && isRepo(dir)) {
    const hasGit = existsSync(join(dir, '.git'));
    results.push({
      path: dir,
      name: extractName(dir),
      lastCommitDate: getLastCommitDate(dir),
      hasGit,
    });
    return;
  }

  // Not a repo (or depth 0 scan root) — descend into children
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (shouldSkip(entry.name)) continue;

    const childPath = join(dir, entry.name);
    walkForRepos(childPath, depth + 1, maxDepth, results);
  }
}

/**
 * Discover repositories under the given root directories.
 *
 * A directory counts as a repo if it contains `.git/` or `package.json`.
 * The walk skips `node_modules`, `.git`, `dist`, `build`, and hidden directories.
 *
 * @param dirs   Absolute paths to root directories to scan
 * @param opts   Optional settings — `maxDepth` defaults to 3
 * @returns      Array of discovered repos sorted by lastCommitDate descending
 */
export function discoverRepos(
  dirs: string[],
  opts?: { maxDepth?: number },
): DiscoveredRepo[] {
  const maxDepth = opts?.maxDepth ?? 3;
  const results: DiscoveredRepo[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const resolved = resolve(dir);
    if (!existsSync(resolved)) continue;

    try {
      if (!statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }

    walkForRepos(resolved, 0, maxDepth, results);
  }

  // Deduplicate by resolved path
  const deduped: DiscoveredRepo[] = [];
  for (const repo of results) {
    const key = resolve(repo.path);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(repo);
  }

  // Sort by lastCommitDate descending (repos without a date go to the end)
  deduped.sort((a, b) => {
    if (a.lastCommitDate && b.lastCommitDate) {
      return b.lastCommitDate.localeCompare(a.lastCommitDate);
    }
    if (a.lastCommitDate) return -1;
    if (b.lastCommitDate) return 1;
    return a.name.localeCompare(b.name);
  });

  return deduped;
}

/**
 * Return a list of conventional source-code directories under the user's home
 * that actually exist on disk.
 *
 * Checked paths: ~/projects, ~/code, ~/src, ~/repos, ~/dev
 */
export function getDefaultScanDirs(): string[] {
  const home = homedir();
  const candidates = ['projects', 'code', 'src', 'repos', 'dev'];

  return candidates
    .map((name) => join(home, name))
    .filter((dir) => {
      try {
        return existsSync(dir) && statSync(dir).isDirectory();
      } catch {
        return false;
      }
    });
}
