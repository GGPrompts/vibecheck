import { execSync } from 'child_process';
import { existsSync } from 'fs';
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
  // Simple heuristic: major version bump = high, minor = medium, patch = low
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  if (currentParts[0] !== latestParts[0]) return 'high';
  if (currentParts[1] !== latestParts[1]) return 'medium';
  return 'low';
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running cargo outdated...');

    let stdout = '';
    try {
      stdout = execSync('cargo outdated --format json', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        stdout = (error as { stdout: string }).stdout;
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
          return {
            score: -1,
            confidence: 0,
            findings: [],
            metrics: {},
            summary: 'cargo-outdated is not installed. Install with: cargo install cargo-outdated',
          };
        }
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `cargo outdated failed: ${msg}`,
        };
      }
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
    description: 'Outdated dependency checking via cargo outdated',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
