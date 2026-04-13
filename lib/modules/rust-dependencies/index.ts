import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface CargoOutdatedDependency {
  name: string;
  project: string;
  latest: string;
  kind: string;
  compat?: string;
}

interface CargoOutdatedOutput {
  dependencies: CargoOutdatedDependency[];
}

function classifySeverity(current: string, latest: string): Severity {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  if (currentParts[0] !== latestParts[0]) return 'high';
  if (currentParts[1] !== latestParts[1]) return 'medium';
  return 'low';
}

/**
 * Parse `cargo update --dry-run --verbose` output as a fallback when
 * cargo-outdated is unavailable or fails (e.g. vendored crates).
 * Returns null if parsing fails.
 */
function parseCargoUpdateDryRun(repoPath: string): ModuleResult | null {
  let output: string;
  try {
    // cargo update --dry-run writes to stderr, so merge streams
    output = execSync('cargo update --dry-run --verbose 2>&1', {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof (error as { stdout: unknown }).stdout === 'string'
    ) {
      output = (error as { stdout: string }).stdout;
    } else {
      return null;
    }
  }

  // Parse lines like: "    Updating cc v1.2.59 -> v1.2.60"
  const updatePattern = /Updating\s+(\S+)\s+v(\S+)\s+->\s+v(\S+)/g;
  const findings: Finding[] = [];
  let match: RegExpExecArray | null;

  while ((match = updatePattern.exec(output)) !== null) {
    const [, name, current, latest] = match;
    const severity = classifySeverity(current, latest);
    const message = `${name}: ${current} -> ${latest}`;

    const finding: Omit<Finding, 'id' | 'fingerprint'> = {
      severity,
      filePath: 'Cargo.toml',
      message,
      category: 'outdated-dependency',
      suggestion: `Update ${name} to ${latest}`,
    };

    findings.push({
      ...finding,
      id: nanoid(),
      fingerprint: generateFingerprint('rust-dependencies', finding),
    });
  }

  // Parse "Unchanged" lines — these are deps pinned below latest.
  // Format: "   Unchanged cosmic-text v0.15.0 (available: v0.18.2)"
  const unchangedPattern = /Unchanged\s+(\S+)\s+v(\S+)\s+\(available:\s+v(\S+)\)/g;
  let unchangedMatch: RegExpExecArray | null;
  while ((unchangedMatch = unchangedPattern.exec(output)) !== null) {
    const [, name, current, latest] = unchangedMatch;
    const severity = classifySeverity(current, latest);
    const message = `${name}: ${current} -> ${latest} (pinned below latest)`;

    const finding: Omit<Finding, 'id' | 'fingerprint'> = {
      severity,
      filePath: 'Cargo.toml',
      message,
      category: 'outdated-dependency',
      suggestion: `Update ${name} to ${latest} (may require semver-incompatible changes)`,
    };

    findings.push({
      ...finding,
      id: nanoid(),
      fingerprint: generateFingerprint('rust-dependencies', finding),
    });
  }

  const outdatedCount = findings.length;
  // Count total deps from Cargo.lock if available
  let total = outdatedCount;
  const lockfilePath = join(repoPath, 'Cargo.lock');
  if (existsSync(lockfilePath)) {
    try {
      const lockContent = readFileSync(lockfilePath, 'utf-8');
      // Each [[package]] section is one dependency
      const packageCount = (lockContent.match(/\[\[package]]/g) || []).length;
      if (packageCount > 0) total = packageCount;
    } catch { /* use fallback */ }
  }
  const score = Math.max(0, 100 - 5 * outdatedCount);

  const summary =
    outdatedCount === 0
      ? 'All Rust dependencies are up to date.'
      : `Found ${outdatedCount} updatable Rust dependencies (via cargo update --dry-run).`;

  return {
    score,
    confidence: 0.8, // slightly lower confidence than cargo-outdated
    findings,
    metrics: { total, outdated: outdatedCount },
    summary,
  };
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running cargo outdated...');

    let stdout = '';
    let cargoOutdatedFailed = false;

    try {
      stdout = execSync('cargo outdated --format json', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
        // cargo-outdated not installed — fall back to cargo update --dry-run
        cargoOutdatedFailed = true;
      } else if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        const captured = (error as { stdout: string }).stdout;
        if (captured.trim() && captured.trim().startsWith('{')) {
          stdout = captured;
        } else {
          // cargo outdated crashed (e.g. vendored crate paths) — fall back
          cargoOutdatedFailed = true;
        }
      } else {
        cargoOutdatedFailed = true;
      }
    }

    // Fall back to cargo update --dry-run when cargo-outdated fails
    if (cargoOutdatedFailed) {
      opts.onProgress?.(30, 'Falling back to cargo update --dry-run...');
      const fallbackResult = parseCargoUpdateDryRun(repoPath);
      if (fallbackResult) {
        opts.onProgress?.(100, 'Rust dependency check complete.');
        return fallbackResult;
      }
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Rust dependency check failed. Install cargo-outdated for best results: cargo install cargo-outdated',
      };
    }

    if (!stdout.trim()) {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { total: 0, outdated: 0 },
        summary: 'All Rust dependencies are up to date.',
      };
    }

    let outdatedData: CargoOutdatedOutput;
    try {
      outdatedData = JSON.parse(stdout);
    } catch {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Failed to parse cargo outdated JSON output.',
      };
    }

    opts.onProgress?.(50, 'Parsing outdated dependencies...');

    const findings: Finding[] = [];
    const deps = outdatedData.dependencies ?? [];

    // Filter to only actually outdated deps (project version differs from latest)
    const outdatedDeps = deps.filter((d) => d.project !== d.latest && d.latest !== '--');

    for (const dep of outdatedDeps) {
      const severity = classifySeverity(dep.project, dep.latest);
      const message = `${dep.name}: ${dep.project} -> ${dep.latest}`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath: 'Cargo.toml',
        message,
        category: 'outdated-dependency',
        suggestion: `Update ${dep.name} to ${dep.latest} in Cargo.toml`,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('rust-dependencies', finding),
      });
    }

    const outdatedCount = outdatedDeps.length;
    const score = Math.max(0, 100 - 5 * outdatedCount);

    const metrics: Record<string, number> = {
      total: deps.length,
      outdated: outdatedCount,
    };

    opts.onProgress?.(100, 'Rust dependency check complete.');

    const summary =
      outdatedCount === 0
        ? 'All Rust dependencies are up to date.'
        : `Found ${outdatedCount} outdated Rust dependencies.`;

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
    id: 'rust-dependencies',
    name: 'Rust Dependencies',
    description: 'Outdated dependency checking via cargo outdated with cargo update fallback',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
