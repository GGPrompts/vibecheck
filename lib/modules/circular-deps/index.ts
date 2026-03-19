import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';

interface DepCruiseModule {
  source: string;
  dependencies: Array<{
    resolved: string;
    circular?: boolean;
    cycle?: string[];
  }>;
}

interface DepCruiseOutput {
  modules?: DepCruiseModule[];
  summary?: {
    violations?: Array<{
      type: string;
      from: string;
      to: string;
      cycle?: string[];
      rule?: { name: string; severity: string };
    }>;
    error: number;
    warn: number;
    info: number;
    totalCruised: number;
  };
}

const MODULE_ID = 'circular-deps';

function detectSourceDirs(repoPath: string): string[] {
  const candidates = ['src', 'lib', 'app', 'source', 'packages'];
  const found: string[] = [];

  for (const dir of candidates) {
    const fullPath = join(repoPath, dir);
    if (existsSync(fullPath)) {
      found.push(dir);
    }
  }

  // If no known source directory, try the repo root but only if there are
  // source files directly in it
  if (found.length === 0) {
    try {
      const entries = readdirSync(repoPath);
      const hasSourceFiles = entries.some(
        (e) => e.endsWith('.ts') || e.endsWith('.js') || e.endsWith('.tsx') || e.endsWith('.jsx')
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

function hasJsOrTsFiles(repoPath: string): boolean {
  try {
    const entries = readdirSync(repoPath, { recursive: true }) as string[];
    return entries.some(
      (e) =>
        typeof e === 'string' &&
        (e.endsWith('.ts') || e.endsWith('.js') || e.endsWith('.tsx') || e.endsWith('.jsx'))
    );
  } catch {
    return false;
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    if (!existsSync(join(repoPath, 'package.json'))) {
      return false;
    }
    return (
      existsSync(join(repoPath, 'tsconfig.json')) ||
      hasJsOrTsFiles(repoPath)
    );
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Detecting source directories...');

    const sourceDirs = detectSourceDirs(repoPath);
    if (sourceDirs.length === 0) {
      return {
        score: 100,
        confidence: 0.5,
        findings: [],
        metrics: { circularDeps: 0 },
        summary: 'No source directories found to analyze.',
      };
    }

    opts.onProgress?.(20, 'Running dependency-cruiser...');

    // Build the depcruise command. We use --no-config to avoid needing a
    // .dependency-cruiser.cjs. We add --do-not-follow node_modules to speed
    // things up, and include-only the source dirs.
    const dirsArg = sourceDirs.join(' ');
    const tsConfigArg = existsSync(join(repoPath, 'tsconfig.json'))
      ? ' --ts-config tsconfig.json'
      : '';
    const cmd = `npx depcruise --output-type json --no-config --do-not-follow "node_modules"${tsConfigArg} ${dirsArg}`;

    let stdout = '';
    try {
      stdout = execSync(cmd, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      // depcruise may exit non-zero on violations
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
          metrics: { error: true },
          summary: `Skipped: dependency-cruiser unavailable or failed. Install with: npm install -D dependency-cruiser`,
        };
      }
    }

    if (!stdout.trim()) {
      return {
        score: 100,
        confidence: 0.8,
        findings: [],
        metrics: { circularDeps: 0 },
        summary: 'No circular dependencies detected (empty output).',
      };
    }

    let cruiseData: DepCruiseOutput;
    try {
      cruiseData = JSON.parse(stdout);
    } catch {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Failed to parse dependency-cruiser JSON output.',
      };
    }

    opts.onProgress?.(60, 'Analyzing circular dependencies...');

    const findings: Finding[] = [];
    // Track unique cycles to avoid duplicates (a cycle A→B→A is the same as B→A→B)
    const seenCycles = new Set<string>();

    // Method 1: Check violations in summary (when rules detect cycles)
    if (cruiseData.summary?.violations) {
      for (const violation of cruiseData.summary.violations) {
        if (violation.cycle && violation.cycle.length > 0) {
          const normalizedCycle = normalizeCycle(violation.cycle);
          const cycleKey = normalizedCycle.join(' → ');
          if (seenCycles.has(cycleKey)) continue;
          seenCycles.add(cycleKey);

          const chain = normalizedCycle.join(' → ');
          const finding: Omit<Finding, 'id' | 'fingerprint'> = {
            severity: 'high',
            filePath: violation.from,
            message: `Circular dependency chain: ${chain}`,
            category: 'circular-dependency',
            suggestion:
              'Break the cycle by extracting shared code into a separate module or using dependency injection.',
          };
          findings.push({
            ...finding,
            id: nanoid(),
            fingerprint: generateFingerprint(MODULE_ID, finding),
          });
        }
      }
    }

    // Method 2: Scan modules for circular flags in dependencies
    if (cruiseData.modules) {
      for (const mod of cruiseData.modules) {
        for (const dep of mod.dependencies) {
          if (dep.circular && dep.cycle && dep.cycle.length > 0) {
            const normalizedCycle = normalizeCycle(dep.cycle);
            const cycleKey = normalizedCycle.join(' → ');
            if (seenCycles.has(cycleKey)) continue;
            seenCycles.add(cycleKey);

            const chain = normalizedCycle.join(' → ');
            const finding: Omit<Finding, 'id' | 'fingerprint'> = {
              severity: 'high',
              filePath: mod.source,
              message: `Circular dependency chain: ${chain}`,
              category: 'circular-dependency',
              suggestion:
                'Break the cycle by extracting shared code into a separate module or using dependency injection.',
            };
            findings.push({
              ...finding,
              id: nanoid(),
              fingerprint: generateFingerprint(MODULE_ID, finding),
            });
          }
        }
      }
    }

    // Scoring: 100 - (15 x number of circular deps), floor at 0
    const score = Math.max(0, 100 - findings.length * 15);

    const metrics: Record<string, number> = {
      circularDeps: findings.length,
      totalModulesCruised: cruiseData.summary?.totalCruised ?? 0,
    };

    opts.onProgress?.(100, 'Circular dependency analysis complete.');

    const summary =
      findings.length === 0
        ? 'No circular dependencies detected.'
        : `Found ${findings.length} circular dependency chain${findings.length === 1 ? '' : 's'}.`;

    return {
      score,
      confidence: 0.95,
      findings,
      metrics,
      summary,
    };
  },
};

/**
 * Normalize a cycle so that the same logical cycle always produces the same
 * string regardless of starting point. We rotate the array so that the
 * lexicographically smallest entry comes first.
 */
function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) return cycle;
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) {
      minIdx = i;
    }
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

registerModule(
  {
    id: MODULE_ID,
    name: 'Circular Dependencies',
    description: 'Circular dependency detection via dependency-cruiser',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
