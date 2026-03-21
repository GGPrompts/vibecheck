import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface OutdatedPackage {
  current: string;
  wanted: string;
  latest: string;
  dependent?: string;
  location?: string;
  type?: string;
}

/**
 * Parse a semver string into [major, minor, patch].
 * Returns [0, 0, 0] if parsing fails.
 */
function parseSemver(version: string): [number, number, number] {
  const cleaned = version.replace(/^[^0-9]*/, '');
  const parts = cleaned.split('.');
  return [
    parseInt(parts[0] ?? '0', 10) || 0,
    parseInt(parts[1] ?? '0', 10) || 0,
    parseInt(parts[2] ?? '0', 10) || 0,
  ];
}

/**
 * Determine how far behind a package is and assign a severity.
 */
function classifyOutdated(
  current: string,
  latest: string
): { severity: Severity; majorsBehind: number; minorsBehind: number; patchesBehind: number } {
  const [curMajor, curMinor, curPatch] = parseSemver(current);
  const [latMajor, latMinor, latPatch] = parseSemver(latest);

  const majorsBehind = latMajor - curMajor;
  const minorsBehind = latMinor - curMinor;
  const patchesBehind = latPatch - curPatch;

  let severity: Severity;
  if (majorsBehind >= 2) {
    severity = 'high';
  } else if (majorsBehind >= 1) {
    severity = 'medium';
  } else if (minorsBehind > 0) {
    severity = 'low';
  } else {
    severity = 'info';
  }

  return { severity, majorsBehind, minorsBehind, patchesBehind };
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'package.json'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running npm outdated...');

    let stdout = '';
    try {
      stdout = execSync('npm outdated --json', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      // npm outdated exits non-zero when packages are outdated -- that's normal.
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        stdout = (error as { stdout: string }).stdout;
      } else {
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `npm outdated failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (!stdout.trim() || stdout.trim() === '{}') {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { totalDeps: 0, outdated: 0, upToDate: 0 },
        summary: 'All dependencies are up to date.',
      };
    }

    let outdatedData: Record<string, OutdatedPackage>;
    try {
      outdatedData = JSON.parse(stdout);
    } catch {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Failed to parse npm outdated JSON output.',
      };
    }

    opts.onProgress?.(50, 'Analyzing dependency versions...');

    const findings: Finding[] = [];
    const entries = Object.entries(outdatedData);

    // Count total dependencies from package.json to calculate up-to-date percentage
    let totalDepsCount = 0;
    try {
      const pkgJsonPath = join(repoPath, 'package.json');
      const pkgJson = JSON.parse(
        readFileSync(pkgJsonPath, 'utf-8')
      );
      totalDepsCount =
        Object.keys(pkgJson.dependencies ?? {}).length +
        Object.keys(pkgJson.devDependencies ?? {}).length;
    } catch {
      // If we can't read package.json, just use the outdated count
      totalDepsCount = entries.length;
    }

    // Ensure we have a reasonable total
    if (totalDepsCount < entries.length) {
      totalDepsCount = entries.length;
    }

    // Weight definitions for scoring
    const severityWeights: Record<Severity, number> = {
      critical: 1.0,
      high: 0.8,
      medium: 0.5,
      low: 0.2,
      info: 0.05,
    };

    let totalPenalty = 0;

    for (const [pkgName, info] of entries) {
      const { severity, majorsBehind, minorsBehind, patchesBehind } =
        classifyOutdated(info.current, info.latest);

      const versionParts: string[] = [];
      if (majorsBehind > 0) versionParts.push(`${majorsBehind} major`);
      if (minorsBehind > 0) versionParts.push(`${minorsBehind} minor`);
      if (patchesBehind > 0) versionParts.push(`${patchesBehind} patch`);
      const versionDesc =
        versionParts.length > 0
          ? versionParts.join(', ') + ' behind'
          : 'outdated';

      const message = `${pkgName}: ${info.current} -> ${info.latest} (${versionDesc})`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath: 'package.json',
        message,
        category: 'outdated-dependency',
        suggestion: `Run \`npm install ${pkgName}@${info.latest}\` to update.`,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('dependencies', finding),
      });

      totalPenalty += severityWeights[severity] ?? 0;
    }

    // Score: percentage of deps that are healthy, weighted by severity
    // Max penalty is if all deps were high severity
    const maxPenalty = totalDepsCount * severityWeights.high;
    const score =
      maxPenalty > 0
        ? Math.max(0, Math.round(100 * (1 - totalPenalty / maxPenalty)))
        : 100;

    const upToDate = totalDepsCount - entries.length;
    const metrics: Record<string, number> = {
      totalDeps: totalDepsCount,
      outdated: entries.length,
      upToDate,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };

    opts.onProgress?.(100, 'Dependency analysis complete.');

    const summary =
      entries.length === 0
        ? 'All dependencies are up to date.'
        : `${entries.length} of ${totalDepsCount} dependencies are outdated (${upToDate} up to date).`;

    return {
      score,
      confidence: 1.0,
      findings,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'dependencies',
    name: 'Dependencies',
    description: 'Dependency staleness analysis',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
