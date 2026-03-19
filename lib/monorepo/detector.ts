import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, basename } from 'path';

export interface Workspace {
  /** Absolute path to the workspace directory */
  path: string;
  /** Display name (from workspace package.json name, or directory basename) */
  name: string;
}

/**
 * Detect monorepo workspaces from a given repo root.
 *
 * Checks:
 * 1. `package.json` `workspaces` field (npm / yarn format)
 * 2. `pnpm-workspace.yaml` `packages` field
 *
 * Returns an array of resolved workspace directories that actually exist
 * on disk and contain a `package.json`.
 */
export function detectWorkspaces(repoPath: string): Workspace[] {
  const patterns = collectGlobPatterns(repoPath);
  if (patterns.length === 0) return [];

  const seen = new Set<string>();
  const workspaces: Workspace[] = [];

  for (const pattern of patterns) {
    const matches = resolveGlob(repoPath, pattern);
    for (const absPath of matches) {
      // Skip root itself
      if (absPath === resolve(repoPath)) continue;

      // Deduplicate
      if (seen.has(absPath)) continue;
      seen.add(absPath);

      // Must have a package.json to count as a workspace
      const pkgPath = join(absPath, 'package.json');
      if (!existsSync(pkgPath)) continue;

      let name = basename(absPath);
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name && typeof pkg.name === 'string') {
          name = pkg.name;
        }
      } catch {
        // fall back to directory name
      }

      workspaces.push({ path: absPath, name });
    }
  }

  return workspaces;
}

/**
 * Resolve a workspace glob pattern relative to the repo root.
 * Supports patterns like "packages/*", "apps/*", "libs/**", or literal paths.
 * Returns absolute paths to matching directories.
 */
function resolveGlob(root: string, pattern: string): string[] {
  // Strip trailing / if present
  const cleaned = pattern.replace(/\/+$/, '');

  // Split into segments
  const segments = cleaned.split('/');
  return resolveSegments(root, segments);
}

function resolveSegments(dir: string, segments: string[]): string[] {
  if (segments.length === 0) {
    // We've resolved all segments; return this directory if it exists
    try {
      if (existsSync(dir) && statSync(dir).isDirectory()) {
        return [dir];
      }
    } catch {
      // ignore
    }
    return [];
  }

  const [current, ...rest] = segments;

  // ** matches any depth of directories
  if (current === '**') {
    const results: string[] = [];
    // Match zero levels (skip the **)
    results.push(...resolveSegments(dir, rest));
    // Match one+ levels
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          const subdir = join(dir, entry.name);
          // Continue matching rest at this level
          results.push(...resolveSegments(subdir, rest));
          // Continue matching ** deeper
          results.push(...resolveSegments(subdir, segments));
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    return results;
  }

  // * matches any single directory entry
  if (current === '*') {
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          results.push(...resolveSegments(join(dir, entry.name), rest));
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    return results;
  }

  // Literal segment or simple wildcard pattern (e.g., "pkg-*")
  if (current.includes('*')) {
    // Convert simple glob to regex
    const regex = new RegExp(
      '^' + current.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    );
    const results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && regex.test(entry.name)) {
          results.push(...resolveSegments(join(dir, entry.name), rest));
        }
      }
    } catch {
      // ignore
    }
    return results;
  }

  // Literal path segment
  return resolveSegments(join(dir, current), rest);
}

/**
 * Collect workspace glob patterns from package.json and pnpm-workspace.yaml.
 */
function collectGlobPatterns(repoPath: string): string[] {
  const patterns: string[] = [];

  // 1. Check package.json workspaces field (npm / yarn)
  try {
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces = pkg.workspaces;
      if (Array.isArray(workspaces)) {
        patterns.push(...workspaces);
      } else if (workspaces && Array.isArray(workspaces.packages)) {
        // yarn classic format: { packages: [...] }
        patterns.push(...workspaces.packages);
      }
    }
  } catch {
    // ignore
  }

  // 2. Check pnpm-workspace.yaml
  try {
    const pnpmPath = join(repoPath, 'pnpm-workspace.yaml');
    if (existsSync(pnpmPath)) {
      const content = readFileSync(pnpmPath, 'utf-8');
      // Simple YAML parsing for the common `packages:` list format.
      // Avoids requiring a full YAML parser as a production dependency.
      const parsed = parsePnpmWorkspaceYaml(content);
      if (parsed.length > 0) {
        patterns.push(...parsed);
      }
    }
  } catch {
    // ignore
  }

  return patterns;
}

/**
 * Minimal parser for pnpm-workspace.yaml.
 * Extracts the `packages:` list entries, which is the only field we need.
 */
function parsePnpmWorkspaceYaml(content: string): string[] {
  const results: string[] = [];
  const lines = content.split('\n');
  let inPackages = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect the packages: key
    if (/^packages\s*:/.test(trimmed)) {
      // Check for inline value  packages: [...]
      const inlineMatch = trimmed.match(/^packages\s*:\s*\[([^\]]*)\]/);
      if (inlineMatch) {
        const items = inlineMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
        results.push(...items.filter(Boolean));
        return results;
      }
      inPackages = true;
      continue;
    }

    // If we're in the packages block, collect list items
    if (inPackages) {
      if (/^-\s+/.test(trimmed) || /^-\s*'/.test(trimmed) || /^-\s*"/.test(trimmed)) {
        const value = trimmed.replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '').trim();
        if (value) results.push(value);
      } else if (trimmed && !trimmed.startsWith('#')) {
        // Hit a new key or non-list line, stop
        break;
      }
    }
  }

  return results;
}
