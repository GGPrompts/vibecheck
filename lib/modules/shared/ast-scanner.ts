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
  '.vercel',
  '.output',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
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
 * Scan source files in a repository for matches against many structural pattern
 * rules in a single pass. Each file is read once and parsed once per distinct
 * parse language, then every compatible rule runs against that tree. Native
 * ast-grep trees are large, so parsing once per rule (the previous shape)
 * multiplied memory by the rule count and was OOM-killed on mid-size repos.
 *
 * Returns matches keyed by rule id; every rule id is present, possibly empty.
 */
export function scanFilesWithRules(
  repoPath: string,
  rules: ScanRule[],
  astGrep: NonNullable<ReturnType<typeof tryLoadAstGrep>>
): Map<string, ScanMatch[]> {
  const { parse: astParse, Lang } = astGrep;

  const results = new Map<string, ScanMatch[]>();
  const usable: { rule: ScanRule; ruleLang: unknown }[] = [];
  for (const rule of rules) {
    results.set(rule.id, []);
    const ruleLang = resolveLang(Lang, rule.language);
    if (ruleLang == null) {
      console.warn(
        `[ast-scanner] Unsupported language "${rule.language}" for rule: ${rule.id}`
      );
      continue;
    }
    usable.push({ rule, ruleLang });
  }
  if (usable.length === 0) return results;

  const sourceFiles = collectSourceFiles(repoPath);

  for (const filePath of sourceFiles) {
    const ext = extname(filePath);
    const fileLang = EXTENSION_TO_LANG[ext];
    if (!fileLang) continue;

    const applicable = usable.filter(({ rule }) =>
      isFileCompatible(fileLang, rule.language)
    );
    if (applicable.length === 0) continue;

    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relativePath = filePath.startsWith(repoPath)
      ? filePath.slice(repoPath.length + 1)
      : filePath;

    // One parse per distinct parse language for this file (Tsx files always
    // parse as Tsx; everything else parses as the rule's language).
    const roots = new Map<unknown, ReturnType<typeof astParse> | null>();
    for (const { rule, ruleLang } of applicable) {
      const parseLang = fileLang === 'Tsx' ? Lang.Tsx : ruleLang;
      if (!roots.has(parseLang)) {
        try {
          roots.set(parseLang, astParse(parseLang as typeof Lang.TypeScript, source));
        } catch {
          roots.set(parseLang, null);
        }
      }
      const root = roots.get(parseLang);
      if (!root) continue;

      let nodeMatches;
      try {
        nodeMatches = root.root().findAll(rule.pattern);
      } catch {
        continue;
      }

      const bucket = results.get(rule.id)!;
      for (const match of nodeMatches) {
        const range = match.range();
        bucket.push({
          filePath,
          relativePath,
          line: range.start.line + 1, // ast-grep lines are 0-indexed
          matchText: match.text(),
        });
      }
    }
  }

  return results;
}

/**
 * Scan source files in a repository for matches against a single structural
 * pattern rule. Callers with many rules should use scanFilesWithRules so each
 * file is parsed once rather than once per rule.
 */
export function scanFiles(
  repoPath: string,
  rule: ScanRule,
  astGrep: NonNullable<ReturnType<typeof tryLoadAstGrep>>
): ScanMatch[] {
  return scanFilesWithRules(repoPath, [rule], astGrep).get(rule.id) ?? [];
}
