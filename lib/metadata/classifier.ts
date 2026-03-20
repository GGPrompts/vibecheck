import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep, posix } from 'path';
import type { VibecheckRc } from '../config/vibecheckrc';

// ── Types ──────────────────────────────────────────────────────────────

type FileRole =
  | 'api-route'
  | 'ui-kit'
  | 'barrel-file'
  | 'public-api'
  | 'provider'
  | 'cli-entrypoint'
  | 'mcp-tool';

// ── Pattern rules ──────────────────────────────────────────────────────

interface PatternRule {
  /** Matches against the POSIX-style relative path from repo root */
  test: (relPath: string) => boolean;
  roles: FileRole[];
}

const PATTERN_RULES: PatternRule[] = [
  {
    // app/api/**/*.ts
    test: (p) => p.startsWith('app/api/') && /\.tsx?$/.test(p),
    roles: ['api-route'],
  },
  {
    // components/ui/**
    test: (p) => p.startsWith('components/ui/'),
    roles: ['ui-kit'],
  },
  {
    // lib/ai/providers/**
    test: (p) => p.startsWith('lib/ai/providers/'),
    roles: ['provider'],
  },
  {
    // bin/**
    test: (p) => p.startsWith('bin/'),
    roles: ['cli-entrypoint'],
  },
  {
    // mcp-server/**
    test: (p) => p.startsWith('mcp-server/'),
    roles: ['mcp-tool'],
  },
];

// ── Directories to skip ────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
]);

// ── Helpers ────────────────────────────────────────────────────────────

/** Convert a native path to POSIX style for consistent matching. */
function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join(posix.sep);
}

/** Check if a file is a barrel (only contains re-export statements). */
function isBarrelFile(filePath: string): boolean {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }

  const lines = content.split('\n');
  let hasExport = false;

  for (const raw of lines) {
    const line = raw.trim();
    // Skip empty lines, comments, 'use strict'
    if (
      line === '' ||
      line.startsWith('//') ||
      line.startsWith('/*') ||
      line.startsWith('*') ||
      line === "'use strict';" ||
      line === '"use strict";'
    ) {
      continue;
    }
    // Must be a re-export line
    if (/^export\s+\{[^}]*\}\s+from\s+['"]/.test(line) || /^export\s+\*\s+from\s+['"]/.test(line) || /^export\s+type\s+\{[^}]*\}\s+from\s+['"]/.test(line)) {
      hasExport = true;
      continue;
    }
    // Any other non-empty line means it's not a pure barrel
    return false;
  }

  return hasExport;
}

/** Read inline @vibecheck role comments from first 5 lines. */
function parseInlineRoles(filePath: string): string[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const roles: string[] = [];
  const lines = content.split('\n').slice(0, 5);
  for (const line of lines) {
    const match = line.match(/\/\/\s*@vibecheck\s+(.+)/);
    if (match) {
      // Support multiple space-separated roles on one line
      roles.push(...match[1].trim().split(/\s+/));
    }
  }
  return roles;
}

// ── Walk ───────────────────────────────────────────────────────────────

function walkFiles(dir: string, results: string[]): void {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walkFiles(join(dir, entry.name), results);
    } else if (entry.isFile()) {
      results.push(join(dir, entry.name));
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

/**
 * Classify every file in a repository by its role.
 *
 * Roles are assigned via:
 *   1. Path-pattern rules (e.g. `app/api/**` -> api-route)
 *   2. Barrel-file detection (index.ts with only re-exports)
 *   3. Inline `// @vibecheck <role>` comments in first 5 lines
 *   4. Manual overrides from `.vibecheckrc` `classify` field
 *
 * @returns Map of relative file path (POSIX) -> deduplicated role array
 */
export function classifyFiles(
  repoPath: string,
  rcConfig?: VibecheckRc,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    return result;
  }

  // Collect all files
  const files: string[] = [];
  walkFiles(repoPath, files);

  for (const absPath of files) {
    const relPath = toPosix(relative(repoPath, absPath));
    const roles = new Set<string>();

    // 1. Pattern-based rules
    for (const rule of PATTERN_RULES) {
      if (rule.test(relPath)) {
        for (const r of rule.roles) roles.add(r);
      }
    }

    // 2. Barrel-file detection: index.ts/index.tsx files that only re-export
    const fileName = relPath.split('/').pop() ?? '';
    if (/^index\.tsx?$/.test(fileName) && isBarrelFile(absPath)) {
      roles.add('barrel-file');
      roles.add('public-api');
    }

    // 3. Inline @vibecheck comments
    if (/\.[jt]sx?$/.test(fileName)) {
      for (const r of parseInlineRoles(absPath)) {
        roles.add(r);
      }
    }

    if (roles.size > 0) {
      result.set(relPath, Array.from(roles));
    }
  }

  // 4. Manual overrides from .vibecheckrc classify field
  if (rcConfig?.classify) {
    for (const [pattern, rawRoles] of Object.entries(rcConfig.classify)) {
      const roleList = Array.isArray(rawRoles) ? rawRoles : [rawRoles];
      // Pattern can be an exact relative path or a simple prefix glob (e.g. "lib/utils/**")
      const isGlob = pattern.includes('*');

      if (isGlob) {
        // Simple prefix matching: strip trailing /** or /*
        const prefix = pattern.replace(/\/?\*+$/, '');
        Array.from(result.keys()).forEach((filePath) => {
          if (filePath.startsWith(prefix)) {
            const existing = result.get(filePath)!;
            const merged = new Set(existing.concat(roleList));
            result.set(filePath, Array.from(merged));
          }
        });
        // Also check files not yet in result
        files.forEach((absPath) => {
          const relPath = toPosix(relative(repoPath, absPath));
          if (relPath.startsWith(prefix) && !result.has(relPath)) {
            result.set(relPath, roleList.slice());
          }
        });
      } else {
        // Exact path match
        const posixPattern = toPosix(pattern);
        if (result.has(posixPattern)) {
          const existing = result.get(posixPattern)!;
          const merged = new Set(existing.concat(roleList));
          result.set(posixPattern, Array.from(merged));
        } else {
          // Add even if file wasn't walked (user knows their repo)
          result.set(posixPattern, roleList.slice());
        }
      }
    }
  }

  return result;
}
