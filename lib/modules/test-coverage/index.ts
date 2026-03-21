import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface CoverageSummaryEntry {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface CoverageSummaryFile {
  lines: CoverageSummaryEntry;
  statements: CoverageSummaryEntry;
  branches: CoverageSummaryEntry;
  functions: CoverageSummaryEntry;
}

interface CoverageSummaryData {
  total: CoverageSummaryFile;
  [filePath: string]: CoverageSummaryFile;
}

const MODULE_ID = 'test-coverage';

function coverageSeverity(pct: number): Severity {
  if (pct === 0) return 'critical';
  if (pct < 20) return 'high';
  if (pct < 50) return 'medium';
  return 'low';
}

/**
 * Parse LCOV format and return per-file line coverage percentages.
 * LCOV format:
 *   SF:<source file>
 *   LF:<lines found>
 *   LH:<lines hit>
 *   end_of_record
 */
function parseLcov(content: string): Map<string, number> {
  const result = new Map<string, number>();
  let currentFile = '';
  let linesFound = 0;
  let linesHit = 0;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      currentFile = line.slice(3);
      linesFound = 0;
      linesHit = 0;
    } else if (line.startsWith('LF:')) {
      linesFound = parseInt(line.slice(3), 10) || 0;
    } else if (line.startsWith('LH:')) {
      linesHit = parseInt(line.slice(3), 10) || 0;
    } else if (line === 'end_of_record') {
      if (currentFile && linesFound > 0) {
        const pct = (linesHit / linesFound) * 100;
        result.set(currentFile, pct);
      } else if (currentFile && linesFound === 0) {
        result.set(currentFile, 0);
      }
      currentFile = '';
    }
  }

  return result;
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return (
      existsSync(join(repoPath, 'coverage')) ||
      existsSync(join(repoPath, 'coverage-summary.json')) ||
      existsSync(join(repoPath, 'lcov.info'))
    );
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Looking for coverage reports...');

    // Try coverage-summary.json first (Jest/Vitest JSON reporter)
    const coverageSummaryPaths = [
      join(repoPath, 'coverage', 'coverage-summary.json'),
      join(repoPath, 'coverage-summary.json'),
    ];

    for (const summaryPath of coverageSummaryPaths) {
      if (existsSync(summaryPath)) {
        opts.onProgress?.(30, 'Parsing coverage-summary.json...');
        try {
          const raw = readFileSync(summaryPath, 'utf-8');
          const data: CoverageSummaryData = JSON.parse(raw);
          return analyzeCoverageSummary(data, opts);
        } catch {
          // Fall through to try other formats
        }
      }
    }

    // Try lcov.info
    const lcovPaths = [
      join(repoPath, 'coverage', 'lcov.info'),
      join(repoPath, 'lcov.info'),
    ];

    for (const lcovPath of lcovPaths) {
      if (existsSync(lcovPath)) {
        opts.onProgress?.(30, 'Parsing lcov.info...');
        try {
          const content = readFileSync(lcovPath, 'utf-8');
          const fileCoverage = parseLcov(content);
          return analyzeLcovData(fileCoverage, opts);
        } catch {
          // Fall through
        }
      }
    }

    return {
      score: -1,
      confidence: 0,
      findings: [],
      metrics: {},
      summary: 'No parseable coverage report found (looked for coverage-summary.json and lcov.info).',
    };
  },
};

function analyzeCoverageSummary(
  data: CoverageSummaryData,
  opts: RunOptions
): ModuleResult {
  opts.onProgress?.(50, 'Analyzing coverage data...');

  const findings: Finding[] = [];
  let totalLines = 0;
  let coveredLines = 0;
  let filesAnalyzed = 0;

  for (const [filePath, fileCoverage] of Object.entries(data)) {
    if (filePath === 'total') continue;

    filesAnalyzed++;
    const linePct = fileCoverage.lines.pct;
    totalLines += fileCoverage.lines.total;
    coveredLines += fileCoverage.lines.covered;

    // Only report files below 50% line coverage
    if (linePct < 50) {
      const severity = coverageSeverity(linePct);
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath,
        message: `Low test coverage: ${linePct.toFixed(1)}% lines, ${fileCoverage.branches.pct.toFixed(1)}% branches, ${fileCoverage.functions.pct.toFixed(1)}% functions`,
        category: 'test-coverage',
        suggestion:
          linePct === 0
            ? 'This file has no test coverage. Add tests covering the core functionality.'
            : `Increase test coverage from ${linePct.toFixed(1)}% to at least 50%.`,
      };
      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint(MODULE_ID, finding),
      });
    }
  }

  // Overall score is the total line coverage percentage
  const overallPct = totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;

  // Use total entry if available for a more accurate overall
  const totalEntry = data.total;
  const actualOverallPct = totalEntry ? totalEntry.lines.pct : overallPct;
  const finalScore = Math.round(Math.min(100, Math.max(0, actualOverallPct)));

  const metrics: Record<string, number> = {
    overallLineCoverage: parseFloat(actualOverallPct.toFixed(1)),
    overallBranchCoverage: totalEntry ? parseFloat(totalEntry.branches.pct.toFixed(1)) : 0,
    overallFunctionCoverage: totalEntry ? parseFloat(totalEntry.functions.pct.toFixed(1)) : 0,
    filesAnalyzed,
    filesBelow50Pct: findings.length,
    totalLines,
    coveredLines,
  };

  opts.onProgress?.(100, 'Coverage analysis complete.');

  const summary =
    findings.length === 0
      ? `Overall line coverage: ${actualOverallPct.toFixed(1)}%. All files above 50% threshold.`
      : `Overall line coverage: ${actualOverallPct.toFixed(1)}%. ${findings.length} file${findings.length === 1 ? '' : 's'} below 50% coverage threshold.`;

  return {
    score: finalScore,
    confidence: 1.0,
    findings,
    metrics,
    summary,
  };
}

function analyzeLcovData(
  fileCoverage: Map<string, number>,
  opts: RunOptions
): ModuleResult {
  opts.onProgress?.(50, 'Analyzing LCOV coverage data...');

  const findings: Finding[] = [];
  let totalPctSum = 0;
  let filesAnalyzed = 0;

  for (const [filePath, pct] of fileCoverage) {
    filesAnalyzed++;
    totalPctSum += pct;

    if (pct < 50) {
      const severity = coverageSeverity(pct);
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath,
        message: `Low test coverage: ${pct.toFixed(1)}% line coverage`,
        category: 'test-coverage',
        suggestion:
          pct === 0
            ? 'This file has no test coverage. Add tests covering the core functionality.'
            : `Increase test coverage from ${pct.toFixed(1)}% to at least 50%.`,
      };
      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint(MODULE_ID, finding),
      });
    }
  }

  const overallPct = filesAnalyzed > 0 ? totalPctSum / filesAnalyzed : 0;
  const score = Math.round(Math.min(100, Math.max(0, overallPct)));

  const metrics: Record<string, number> = {
    overallLineCoverage: parseFloat(overallPct.toFixed(1)),
    filesAnalyzed,
    filesBelow50Pct: findings.length,
  };

  opts.onProgress?.(100, 'Coverage analysis complete.');

  const summary =
    findings.length === 0
      ? `Overall line coverage: ${overallPct.toFixed(1)}%. All files above 50% threshold.`
      : `Overall line coverage: ${overallPct.toFixed(1)}%. ${findings.length} file${findings.length === 1 ? '' : 's'} below 50% coverage threshold.`;

  return {
    score,
    confidence: 0.9,
    findings,
    metrics,
    summary,
  };
}

registerModule(
  {
    id: MODULE_ID,
    name: 'Test Coverage',
    description: 'Test coverage analysis from existing reports',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
