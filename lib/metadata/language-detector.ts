import { existsSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// ── Types ──────────────────────────────────────────────────────────────

export type Language =
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'rust'
  | 'python'
  | 'unknown';

export interface RepoLanguages {
  /** Language with the most files (or sole marker-file language). */
  primary: Language;
  /** All detected languages, ordered by file count descending. */
  all: Language[];
  /** Which marker file was found per language. */
  markers: Partial<Record<Language, string>>;
}

// ── Marker files ────────────────────────────────────────────────────────

interface MarkerDef {
  file: string;
  language: Language;
}

const MARKER_DEFS: MarkerDef[] = [
  { file: 'Cargo.toml', language: 'rust' },
  { file: 'go.mod', language: 'go' },
  { file: 'requirements.txt', language: 'python' },
  { file: 'pyproject.toml', language: 'python' },
  { file: 'setup.py', language: 'python' },
  { file: 'package.json', language: 'javascript' }, // upgraded to TS below
];

// ── Extension → language mapping ────────────────────────────────────────

const EXT_MAP: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.py': 'python',
  '.pyi': 'python',
};

// ── Directories to skip ────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'vendor',
  '.next',
  '.turbo',
  'coverage',
  '__pycache__',
]);

// ── Walk ───────────────────────────────────────────────────────────────

function countExtensions(
  dir: string,
  counts: Map<Language, number>,
  depth: number,
): void {
  // Cap recursion to avoid runaway trees
  if (depth > 20) return;

  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch {
    // Unreadable dir, permission denied, symlink loop, etc.
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      countExtensions(join(dir, entry.name), counts, depth + 1);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      const lang = EXT_MAP[ext];
      if (lang) {
        counts.set(lang, (counts.get(lang) ?? 0) + 1);
      }
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

/**
 * Detect the primary and secondary languages of a repository.
 *
 * Uses two signals:
 *   1. Marker files (package.json, go.mod, Cargo.toml, etc.)
 *   2. File-extension counts (walks the tree, skipping vendor dirs)
 *
 * Fast enough to run at the start of every scan — no file contents are parsed.
 */
export function detectLanguages(repoPath: string): RepoLanguages {
  const fallback: RepoLanguages = {
    primary: 'unknown',
    all: [],
    markers: {},
  };

  if (!existsSync(repoPath)) return fallback;

  try {
    if (!statSync(repoPath).isDirectory()) return fallback;
  } catch {
    return fallback;
  }

  // ── 1. Check marker files ──────────────────────────────────────────

  const markers: Partial<Record<Language, string>> = {};

  for (const { file, language } of MARKER_DEFS) {
    if (existsSync(join(repoPath, file))) {
      // For package.json, upgrade to TS if tsconfig.json exists
      if (file === 'package.json') {
        const lang = existsSync(join(repoPath, 'tsconfig.json'))
          ? 'typescript'
          : 'javascript';
        // Don't overwrite if already set (e.g. python marker found first)
        if (!markers[lang]) markers[lang] = file;
      } else {
        if (!markers[language]) markers[language] = file;
      }
    }
  }

  // ── 2. Count file extensions ──────────────────────────────────────

  const counts = new Map<Language, number>();
  countExtensions(repoPath, counts, 0);

  // ── 3. Determine primary + all ────────────────────────────────────

  const markerLangs = Object.keys(markers) as Language[];
  const countLangs = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  // Union of all detected languages, ordered by file count
  const allSet = new Set<Language>([...countLangs, ...markerLangs]);
  const all = Array.from(allSet);

  // Primary: if exactly one marker language, use it.
  // Otherwise, use the language with the most files.
  let primary: Language = 'unknown';

  if (markerLangs.length === 1) {
    primary = markerLangs[0];
  } else if (countLangs.length > 0) {
    primary = countLangs[0];
  } else if (markerLangs.length > 0) {
    primary = markerLangs[0];
  }

  return { primary, all, markers };
}
