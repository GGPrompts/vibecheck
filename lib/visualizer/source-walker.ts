import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, extname } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count lines in a file. Returns 0 if unreadable. */
export function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/** Detect source directories that exist in the repo. */
export function detectSourceDirs(repoPath: string): string[] {
  const candidates = ['src', 'lib', 'app', 'source', 'packages'];
  const found: string[] = [];

  for (const dir of candidates) {
    if (existsSync(join(repoPath, dir))) {
      found.push(dir);
    }
  }

  if (found.length === 0) {
    try {
      const entries = readdirSync(repoPath);
      const hasSourceFiles = entries.some((e) =>
        SOURCE_EXTENSIONS.has(extname(e)),
      );
      if (hasSourceFiles) {
        found.push('.');
      }
    } catch {
      // ignore
    }
  }

  return found;
}

/**
 * Walk a directory tree and collect all source files, returning paths
 * relative to repoPath.
 */
export function walkSourceFiles(repoPath: string, dirs: string[]): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === 'dist' || entry === 'build') {
        continue;
      }
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
          files.push(relative(repoPath, full));
        }
      } catch {
        // skip unreadable
      }
    }
  }

  for (const d of dirs) {
    walk(resolve(repoPath, d));
  }

  return files;
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

// Regex patterns for matching import/require statements
const IMPORT_PATTERNS = [
  /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
];

const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const NAMED_IMPORT_PATTERN =
  /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

export interface ParsedImport {
  specifier: string;
  isDynamic: boolean;
  symbols: string[];
}

/** Parse imports from a source file. */
export function parseImports(filePath: string): ParsedImport[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const imports = new Map<string, ParsedImport>();

  // Collect dynamic import specifiers first so we can mark them
  const dynamicSpecifiers = new Set<string>();
  let dm: RegExpExecArray | null;
  const dynRe = new RegExp(DYNAMIC_IMPORT_PATTERN.source, 'g');
  while ((dm = dynRe.exec(content)) !== null) {
    dynamicSpecifiers.add(dm[1]);
  }

  // Collect named symbols
  const symbolMap = new Map<string, string[]>();
  const namedRe = new RegExp(NAMED_IMPORT_PATTERN.source, 'g');
  let nm: RegExpExecArray | null;
  while ((nm = namedRe.exec(content)) !== null) {
    const symbols = nm[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const spec = nm[2];
    symbolMap.set(spec, [...(symbolMap.get(spec) ?? []), ...symbols]);
  }

  for (const pattern of IMPORT_PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const specifier = match[1];
      // Skip non-relative imports (packages)
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        continue;
      }
      if (!imports.has(specifier)) {
        imports.set(specifier, {
          specifier,
          isDynamic: dynamicSpecifiers.has(specifier),
          symbols: symbolMap.get(specifier) ?? [],
        });
      }
    }
  }

  return Array.from(imports.values());
}

/** Resolve an import specifier to a file path relative to repoPath. */
export function resolveImport(
  importerRelative: string,
  specifier: string,
  repoPath: string,
  knownFiles: Set<string>,
): string | null {
  let basePath: string;

  if (specifier.startsWith('@/')) {
    // Alias -- resolve relative to repoPath
    basePath = specifier.slice(2);
  } else {
    // Relative import
    const importerDir = join(repoPath, importerRelative, '..');
    basePath = relative(repoPath, resolve(importerDir, specifier));
  }

  // Normalise separators for Windows compat
  basePath = basePath.replace(/\\/g, '/');

  // Try exact match first
  if (knownFiles.has(basePath)) return basePath;

  // Try adding extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
  for (const ext of extensions) {
    if (knownFiles.has(basePath + ext)) return basePath + ext;
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = basePath + '/index' + ext;
    if (knownFiles.has(indexPath)) return indexPath;
  }

  return null;
}
