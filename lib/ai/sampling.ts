import { readFileSync, readdirSync } from 'fs';
import { join, relative, extname } from 'path';
import type { ModuleResult } from '@/lib/modules/types';

interface SampledFile {
  filePath: string;
  reason: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Dimension extractors
// ---------------------------------------------------------------------------

/**
 * Extract per-file complexity scores from a complexity module result.
 * The complexity module stores findings with category 'high-complexity' and 'long-file',
 * and metrics like maxComplexity per file.
 * We use the finding severity as a proxy: high=1.0, medium=0.7, low=0.4.
 */
function extractComplexityScores(
  moduleResults: ModuleResult[]
): Map<string, number> {
  const scores = new Map<string, number>();
  const complexityResult = moduleResults.find(
    (r) => r.metrics['totalFunctions'] !== undefined && r.metrics['maxComplexity'] !== undefined
  );
  if (!complexityResult) return scores;

  for (const finding of complexityResult.findings) {
    if (!finding.filePath) continue;
    const severityWeight =
      finding.severity === 'critical' ? 1.0
      : finding.severity === 'high' ? 0.9
      : finding.severity === 'medium' ? 0.6
      : 0.3;
    const current = scores.get(finding.filePath) ?? 0;
    scores.set(finding.filePath, Math.max(current, severityWeight));
  }
  return scores;
}

/**
 * Extract per-file churn counts from a git-health module result.
 * Git-health findings with category 'churn-hotspot' contain commit counts in the message.
 */
function extractChurnScores(
  moduleResults: ModuleResult[]
): Map<string, number> {
  const scores = new Map<string, number>();
  const gitResult = moduleResults.find(
    (r) => r.metrics['churnHealth'] !== undefined
  );
  if (!gitResult) return scores;

  for (const finding of gitResult.findings) {
    if (finding.category !== 'churn-hotspot' || !finding.filePath) continue;
    // Extract commit count from message like "High churn: 42 commits ..."
    const match = finding.message.match(/(\d+)\s+commits/);
    const commits = match ? parseInt(match[1], 10) : 1;
    scores.set(finding.filePath, commits);
  }
  return scores;
}

/**
 * Count how many other source files import a given file.
 * This is a lightweight heuristic: scan source files for import/require statements.
 */
function countImports(
  repoPath: string,
  sourceFiles: string[]
): Map<string, number> {
  const importCounts = new Map<string, number>();

  // Initialize all files with 0
  for (const file of sourceFiles) {
    const relPath = relative(repoPath, file);
    importCounts.set(relPath, 0);
  }

  // Build a set of basenames / relative paths for matching
  const relPaths = sourceFiles.map((f) => relative(repoPath, f));

  for (const file of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    // Match import/require patterns
    const importRegex = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1] ?? match[2];
      if (!importPath || importPath.startsWith('@') && !importPath.startsWith('@/')) continue;
      if (!importPath.startsWith('.') && !importPath.startsWith('@/')) continue;

      // Resolve to a relative path and try to match against known files
      const resolved = importPath.startsWith('@/')
        ? importPath.slice(2)
        : relative(repoPath, join(file, '..', importPath));

      // Try matching with and without extensions
      for (const relPath of relPaths) {
        const withoutExt = relPath.replace(/\.(ts|tsx|js|jsx)$/, '');
        const isIndex = relPath.endsWith('/index.ts') || relPath.endsWith('/index.tsx')
          || relPath.endsWith('/index.js') || relPath.endsWith('/index.jsx');
        const dirPath = isIndex ? relPath.replace(/\/index\.(ts|tsx|js|jsx)$/, '') : null;

        if (
          resolved === relPath ||
          resolved === withoutExt ||
          (dirPath && resolved === dirPath)
        ) {
          importCounts.set(relPath, (importCounts.get(relPath) ?? 0) + 1);
          break;
        }
      }
    }
  }

  return importCounts;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', 'out', '.git',
  'coverage', '.turbo', '.vercel', '__pycache__', '.cache',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx',   // JavaScript/TypeScript
  '.go',                           // Go
  '.py',                           // Python
  '.rs',                           // Rust
  '.java', '.kt', '.kts',         // JVM
  '.rb',                           // Ruby
  '.swift',                        // Swift
  '.c', '.cpp', '.h', '.hpp',     // C/C++
  '.cs',                           // C#
  '.php',                          // PHP
  '.lua',                          // Lua
  '.zig',                          // Zig
]);

function collectSourceFiles(dir: string, files: string[] = []): string[] {
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
      if (!EXCLUDE_DIRS.has(entry.name)) {
        collectSourceFiles(fullPath, files);
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Normalization helper
// ---------------------------------------------------------------------------

function normalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const max = Math.max(...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => v / max);
}

// ---------------------------------------------------------------------------
// Main selection function
// ---------------------------------------------------------------------------

const DEFAULT_MAX_FILES = 20;
const ABSOLUTE_MAX_FILES = 30;

/**
 * Select files for AI analysis, weighted by complexity, churn, and import count.
 *
 * Composite score = complexity * 0.4 + churn * 0.3 + imports * 0.3
 * All dimensions are normalized to 0-1 before combining.
 */
export async function selectFilesForAnalysis(
  repoPath: string,
  moduleResults: ModuleResult[],
  maxFiles?: number
): Promise<SampledFile[]> {
  const limit = Math.min(maxFiles ?? DEFAULT_MAX_FILES, ABSOLUTE_MAX_FILES);

  const allFiles = collectSourceFiles(repoPath);
  if (allFiles.length === 0) return [];

  // Extract dimension data
  const complexityScores = extractComplexityScores(moduleResults);
  const churnScores = extractChurnScores(moduleResults);
  const importCounts = countImports(repoPath, allFiles);

  // Build raw score arrays aligned by relative path
  const relPaths = allFiles.map((f) => relative(repoPath, f));

  const rawComplexity = relPaths.map((p) => complexityScores.get(p) ?? 0);
  const rawChurn = relPaths.map((p) => churnScores.get(p) ?? 0);
  const rawImports = relPaths.map((p) => importCounts.get(p) ?? 0);

  // Normalize each dimension to 0-1
  const normComplexity = normalize(rawComplexity);
  const normChurn = normalize(rawChurn);
  const normImports = normalize(rawImports);

  // Compute composite scores
  const scored: Array<{ relPath: string; score: number; reasons: string[] }> = [];

  for (let i = 0; i < relPaths.length; i++) {
    const cScore = normComplexity[i];
    const chScore = normChurn[i];
    const iScore = normImports[i];
    const composite = cScore * 0.4 + chScore * 0.3 + iScore * 0.3;

    const reasons: string[] = [];
    if (cScore > 0) reasons.push(`complexity: ${(cScore * 100).toFixed(0)}%`);
    if (chScore > 0) reasons.push(`churn: ${(chScore * 100).toFixed(0)}%`);
    if (iScore > 0) reasons.push(`imports: ${(iScore * 100).toFixed(0)}%`);
    if (reasons.length === 0) reasons.push('baseline inclusion');

    scored.push({ relPath: relPaths[i], score: composite, reasons });
  }

  // Sort descending by composite score
  scored.sort((a, b) => b.score - a.score);

  // Take top N
  const selected = scored.slice(0, limit);

  return selected.map(({ relPath, score, reasons }) => ({
    filePath: relPath,
    reason: reasons.join(', '),
    score: Math.round(score * 1000) / 1000,
  }));
}
