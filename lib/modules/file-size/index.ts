import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, posix, sep } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Line-count thresholds and their corresponding severity. */
const THRESHOLDS: { lines: number; severity: Severity }[] = [
  { lines: 2000, severity: 'high' },
  { lines: 1000, severity: 'medium' },
  { lines: 500, severity: 'low' },
  { lines: 300, severity: 'info' },
];

/** Multiplier applied to thresholds for generated, config, and test-fixture files. */
const RELAXED_MULTIPLIER = 2;

/** Directories that should always be skipped during traversal. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  '.turbo',
  '.vercel',
  'coverage',
  '__pycache__',
  '.cache',
]);

/** Lock files that should be skipped entirely. */
const LOCK_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'composer.lock',
  'go.sum',
]);

/** Source file extensions we care about (language-agnostic). */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.rs',
  '.go',
  '.java', '.kt', '.kts',
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.scala',
  '.lua',
  '.ex', '.exs',
  '.zig',
  '.vue', '.svelte',
  '.astro',
  '.css', '.scss', '.less',
  '.sql',
  '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.toml', '.json', '.jsonc',
  '.xml',
  '.html', '.htm',
  '.md', '.mdx',
  '.graphql', '.gql',
  '.proto',
  '.tf', '.hcl',
  '.dart',
  '.r', '.R',
  '.m', '.mm',        // Objective-C
  '.pl', '.pm',       // Perl
  '.clj', '.cljs',    // Clojure
  '.hs',              // Haskell
  '.erl', '.hrl',     // Erlang
  '.ml', '.mli',      // OCaml
  '.nim',
  '.v',               // V / Verilog
]);

// ---------------------------------------------------------------------------
// File role patterns for relaxed thresholds
// ---------------------------------------------------------------------------

/** File-role strings from the classifier that warrant relaxed thresholds. */
const RELAXED_FILE_ROLES = new Set([
  'barrel-file',      // mostly re-exports, long but trivial
]);

/** Path patterns that indicate generated, config, or test-fixture files. */
const RELAXED_PATH_PATTERNS: RegExp[] = [
  // Generated / auto-generated files
  /\.generated\./,
  /\.gen\./,
  /\.g\./,
  /generated[/\\]/i,

  // Config files
  /\.config\.(ts|js|mjs|cjs)$/,
  /tsconfig.*\.json$/,
  /eslint.*\.(json|yaml|yml|js|cjs|mjs)$/,
  /prettier.*\.(json|yaml|yml|js|cjs|mjs)$/,

  // Test fixtures / data
  /[/\\]__fixtures__[/\\]/,
  /[/\\]__mocks__[/\\]/,
  /[/\\]fixtures[/\\]/,
  /[/\\]test[_-]?data[/\\]/,
  /[/\\]testdata[/\\]/,

  // Migration files (often auto-generated, long SQL)
  /[/\\]migrations?[/\\]/,

  // Schema dumps
  /schema\.(sql|prisma|graphql|gql)$/,

  // Snapshot test files
  /\.snap$/,
];

/**
 * Determine whether a file should receive relaxed (2x) thresholds.
 *
 * Uses both the classifier's file-role map and path-based heuristics to
 * identify generated output, configuration, and test-fixture files.
 */
function shouldRelaxThresholds(
  relPath: string,
  fileRoles?: Map<string, string[]>,
): boolean {
  // Check classifier roles first
  const roles = fileRoles?.get(relPath);
  if (roles?.some((r) => RELAXED_FILE_ROLES.has(r))) return true;

  // Fall back to path-based heuristics
  return RELAXED_PATH_PATTERNS.some((re) => re.test(relPath));
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join(posix.sep);
}

/**
 * Detect whether a file is likely binary by checking the first 8 KB for
 * null bytes.  This avoids counting lines in images, compiled artefacts, etc.
 */
function isBinaryFile(filePath: string): boolean {
  try {
    const fd = readFileSync(filePath, { flag: 'r' });
    const slice = fd.subarray(0, 8192);
    return slice.includes(0);
  } catch {
    return true; // if we can't read it, treat as binary
  }
}

interface SourceFileInfo {
  absPath: string;
  relPath: string; // POSIX-style, relative to repo root
}

/**
 * Recursively collect source files, skipping vendored / generated dirs,
 * lock files, and binary files.
 */
function collectFiles(dir: string, repoPath: string, files: SourceFileInfo[] = []): SourceFileInfo[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' }) as import('fs').Dirent[];
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        collectFiles(fullPath, repoPath, files);
      }
    } else if (entry.isFile()) {
      if (LOCK_FILES.has(entry.name)) continue;

      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      files.push({
        absPath: fullPath,
        relPath: toPosix(relative(repoPath, fullPath)),
      });
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Line counting
// ---------------------------------------------------------------------------

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // Count newlines; an empty file is 0 lines
    if (content.length === 0) return 0;
    let count = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Severity determination
// ---------------------------------------------------------------------------

function getSeverity(lineCount: number, relaxed: boolean): Severity | null {
  const multiplier = relaxed ? RELAXED_MULTIPLIER : 1;

  for (const threshold of THRESHOLDS) {
    if (lineCount >= threshold.lines * multiplier) {
      return threshold.severity;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    // Works on any repo — just counts lines
    return true;
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Collecting source files...');

    const sourceFiles = collectFiles(repoPath, repoPath);

    if (sourceFiles.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { totalFiles: 0 },
        summary: 'No source files found to check.',
      };
    }

    opts.onProgress?.(10, `Counting lines in ${sourceFiles.length} files...`);

    const findings: Finding[] = [];
    let filesInHealthyRange = 0;
    let totalLines = 0;
    let maxLines = 0;
    let maxLinesFile = '';

    for (let i = 0; i < sourceFiles.length; i++) {
      const file = sourceFiles[i];

      // Skip binary files that slipped past extension filtering
      if (isBinaryFile(file.absPath)) continue;

      const lineCount = countLines(file.absPath);
      totalLines += lineCount;

      if (lineCount > maxLines) {
        maxLines = lineCount;
        maxLinesFile = file.relPath;
      }

      const relaxed = shouldRelaxThresholds(file.relPath, opts.fileRoles);
      const healthyLimit = relaxed ? 500 * RELAXED_MULTIPLIER : 500;

      if (lineCount < healthyLimit) {
        filesInHealthyRange++;
      }

      const severity = getSeverity(lineCount, relaxed);
      if (severity) {
        const thresholdUsed = relaxed ? '(relaxed) ' : '';
        const message = `File has ${lineCount.toLocaleString()} lines ${thresholdUsed}(${file.relPath})`;

        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity,
          filePath: file.relPath,
          message,
          category: 'oversized-file',
          suggestion:
            lineCount >= 2000
              ? 'This file is very large. Break it into smaller, focused modules to improve readability and reduce review difficulty.'
              : lineCount >= 1000
                ? 'Consider splitting this file into smaller modules. Large files are harder to navigate and maintain.'
                : lineCount >= 500
                  ? 'This file is getting long. Look for logical boundaries where it could be split.'
                  : 'File is approaching the complexity threshold. Keep an eye on growth.',
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('file-size', finding),
        });
      }

      // Progress updates every 100 files
      if ((i + 1) % 100 === 0) {
        opts.onProgress?.(
          10 + Math.round(((i + 1) / sourceFiles.length) * 80),
          `Checked ${i + 1} of ${sourceFiles.length} files...`,
        );
      }
    }

    opts.onProgress?.(90, 'Computing score...');

    // Score: percentage of files in healthy range, scaled 0-100
    const score = sourceFiles.length > 0
      ? Math.round((filesInHealthyRange / sourceFiles.length) * 100)
      : 100;

    const metrics: Record<string, number> = {
      totalFiles: sourceFiles.length,
      totalLines,
      maxLines,
      filesInHealthyRange,
      oversizedFiles: findings.length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };

    opts.onProgress?.(100, 'File size analysis complete.');

    const summaryParts: string[] = [
      `Analyzed ${sourceFiles.length} files (${totalLines.toLocaleString()} total lines).`,
    ];

    if (findings.length === 0) {
      summaryParts.push('All files are within healthy size limits.');
    } else {
      summaryParts.push(`Found ${findings.length} oversized files.`);
      if (maxLinesFile) {
        summaryParts.push(`Largest: ${maxLinesFile} (${maxLines.toLocaleString()} lines).`);
      }
    }

    return {
      score,
      confidence: sourceFiles.length >= 10 ? 1.0 : 0.7,
      findings,
      metrics,
      summary: summaryParts.join(' '),
    };
  },
};

registerModule(
  {
    id: 'file-size',
    name: 'File Size',
    description:
      'Flags oversized source files that are hard to navigate, review, and analyze',
    category: 'static',
    defaultEnabled: true,
  },
  runner,
);
