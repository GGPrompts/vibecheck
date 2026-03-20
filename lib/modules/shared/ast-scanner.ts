import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

/** File extensions to scan, mapped to ast-grep Lang enum values */
const EXTENSION_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'Tsx',
  '.js': 'JavaScript',
  '.jsx': 'Tsx',
  '.py': 'Python',
};

const SCANNABLE_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_LANG));

/** Directories to skip during file walking */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
]);

/**
 * Recursively collect source files from a directory.
 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (stat.isFile() && SCANNABLE_EXTENSIONS.has(extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Attempt to use @ast-grep/napi for scanning.
 * Returns null if the module is unavailable.
 * Uses dynamic require() because @ast-grep/napi is a native Node addon
 * listed in serverExternalPackages in next.config.ts.
 */
export function tryLoadAstGrep(): typeof import('@ast-grep/napi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@ast-grep/napi');
  } catch {
    return null;
  }
}

/**
 * Minimal rule shape required by the shared scanner.
 * Both compliance rules and YAML-based custom rules satisfy this interface
 * through TypeScript's structural typing.
 */
interface ScanRule {
  id: string;
  pattern: string;
  language: string;
}

interface ScanMatch {
  filePath: string;
  relativePath: string;
  line: number;
  matchText: string;
}

/**
 * Resolve an ast-grep Lang enum value from a language string.
 * Handles common aliases like 'typescript', 'javascript', 'python', etc.
 */
function resolveLang(
  Lang: Record<string, unknown>,
  language: string
): unknown | null {
  const lower = language.toLowerCase();
  const mapping: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    tsx: 'Tsx',
    jsx: 'Tsx',
    python: 'Python',
  };
  const enumKey = mapping[lower];
  if (!enumKey) return null;
  return (Lang as Record<string, unknown>)[enumKey] ?? null;
}

/**
 * Check whether a file's extension-based language is compatible with a rule's language.
 */
function isFileCompatible(fileLang: string, ruleLanguage: string): boolean {
  const lower = ruleLanguage.toLowerCase();
  if (lower === 'typescript') {
    return fileLang === 'TypeScript' || fileLang === 'Tsx';
  }
  if (lower === 'javascript') {
    return fileLang === 'JavaScript' || fileLang === 'Tsx';
  }
  if (lower === 'tsx' || lower === 'jsx') {
    return fileLang === 'Tsx';
  }
  if (lower === 'python') {
    return fileLang === 'Python';
  }
  return false;
}

/**
 * Scan source files in a repository for matches against a structural pattern rule.
 * This is the generic scanning engine used by both compliance and custom ast-rules modules.
 */
export function scanFiles(
  repoPath: string,
  rule: ScanRule,
  astGrep: NonNullable<ReturnType<typeof tryLoadAstGrep>>
): ScanMatch[] {
  const { parse: astParse, Lang } = astGrep;

  const matches: ScanMatch[] = [];
  const sourceFiles = collectSourceFiles(repoPath);

  const ruleLang = resolveLang(Lang, rule.language);
  if (ruleLang == null) {
    console.warn(
      `[ast-scanner] Unsupported language "${rule.language}" for rule: ${rule.id}`
    );
    return [];
  }

  for (const filePath of sourceFiles) {
    const ext = extname(filePath);
    const fileLang = EXTENSION_TO_LANG[ext];

    if (!fileLang) continue;
    if (!isFileCompatible(fileLang, rule.language)) continue;

    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Parse with the appropriate language — use Tsx for .tsx/.jsx files
    const parseLang =
      fileLang === 'Tsx' ? Lang.Tsx : (ruleLang as typeof Lang.TypeScript);
    let root;
    try {
      root = astParse(parseLang, source);
    } catch {
      continue;
    }

    const rootNode = root.root();
    let nodeMatches;
    try {
      nodeMatches = rootNode.findAll(rule.pattern);
    } catch {
      continue;
    }

    for (const match of nodeMatches) {
      const range = match.range();
      const relativePath = filePath.startsWith(repoPath)
        ? filePath.slice(repoPath.length + 1)
        : filePath;

      matches.push({
        filePath,
        relativePath,
        line: range.start.line + 1, // ast-grep lines are 0-indexed
        matchText: match.text(),
      });
    }
  }

  return matches;
}
