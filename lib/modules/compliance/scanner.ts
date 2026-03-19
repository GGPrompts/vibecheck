import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding } from '../types';
import type { ComplianceRule } from './rules/hipaa';

/** File extensions to scan, mapped to ast-grep Lang enum values */
const EXTENSION_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'Tsx',
  '.js': 'JavaScript',
  '.jsx': 'Tsx',
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
 */
function tryLoadAstGrep(): typeof import('@ast-grep/napi') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@ast-grep/napi');
  } catch {
    return null;
  }
}

/**
 * Scan a repository for compliance violations matching a single rule.
 * Uses @ast-grep/napi to parse and search files using structural pattern matching.
 */
export async function scanWithRule(
  repoPath: string,
  rule: ComplianceRule
): Promise<Finding[]> {
  const astGrep = tryLoadAstGrep();
  if (!astGrep) {
    // If ast-grep is not available, return empty (fail open with a warning)
    console.warn(
      '[compliance] @ast-grep/napi not available, skipping rule:',
      rule.id
    );
    return [];
  }

  const { parse: astParse, Lang } = astGrep;

  const findings: Finding[] = [];
  const sourceFiles = collectSourceFiles(repoPath);

  // Determine which Lang enum value to use for this rule
  const ruleLang =
    rule.language === 'javascript' ? Lang.JavaScript : Lang.TypeScript;

  for (const filePath of sourceFiles) {
    const ext = extname(filePath);
    const fileLang = EXTENSION_TO_LANG[ext];

    // Skip files whose language doesn't match the rule
    // TypeScript rules can also match .tsx files, JS rules match .jsx
    if (!fileLang) continue;

    // TypeScript rules scan .ts and .tsx files; JavaScript rules scan .js and .jsx
    if (rule.language === 'typescript' && fileLang !== 'TypeScript' && fileLang !== 'Tsx') {
      continue;
    }
    if (rule.language === 'javascript' && fileLang !== 'JavaScript' && fileLang !== 'Tsx') {
      continue;
    }

    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    // Parse with the appropriate language
    const parseLang = fileLang === 'Tsx' ? Lang.Tsx : ruleLang;
    let root;
    try {
      root = astParse(parseLang, source);
    } catch {
      // Skip files that fail to parse
      continue;
    }

    const rootNode = root.root();
    let matches;
    try {
      matches = rootNode.findAll(rule.pattern);
    } catch {
      // Pattern may be invalid for this file -- skip
      continue;
    }

    for (const match of matches) {
      const range = match.range();
      const relativePath = filePath.startsWith(repoPath)
        ? filePath.slice(repoPath.length + 1)
        : filePath;

      // Line numbers in ast-grep are 0-indexed
      const line = range.start.line + 1;

      const message = `[${rule.hipaaRef}] ${rule.message}`;

      const findingData: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: rule.severity,
        filePath: relativePath,
        line,
        message,
        category: rule.hipaaCategory,
        suggestion: rule.suggestion,
      };

      findings.push({
        ...findingData,
        id: nanoid(),
        fingerprint: generateFingerprint('compliance-hipaa', findingData),
      });
    }
  }

  return findings;
}
