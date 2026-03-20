import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Run a grep command and parse results into structured matches.
 * Returns an empty array if the pattern is not found.
 */
function grepPattern(repoPath: string, pattern: string): GrepMatch[] {
  try {
    const stdout = execSync(
      `grep -rn --include='*.ts' --include='*.tsx' -E ${JSON.stringify(pattern)} . || true`,
      {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GREP_OPTIONS: '' },
      }
    );

    const matches: GrepMatch[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      // Skip node_modules matches
      if (line.includes('node_modules/')) continue;

      // Format: ./path/to/file.ts:42:matched text
      const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
      if (match) {
        matches.push({
          file: match[1],
          line: parseInt(match[2], 10),
          text: match[3].trim(),
        });
      }
    }
    return matches;
  } catch {
    return [];
  }
}

/**
 * Check which strict flags are enabled in tsconfig.json.
 */
function checkStrictFlags(repoPath: string): { enabled: string[]; missing: string[] } {
  const strictFlags = [
    'strict',
    'noImplicitAny',
    'strictNullChecks',
    'noImplicitReturns',
    'strictPropertyInitialization',
  ];

  const tsconfigPath = join(repoPath, 'tsconfig.json');
  let compilerOptions: Record<string, unknown> = {};

  try {
    const raw = readFileSync(tsconfigPath, 'utf-8');
    // Strip JSON comments (single-line // and block /* */) before parsing
    const stripped = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const tsconfig = JSON.parse(stripped);
    compilerOptions = tsconfig.compilerOptions ?? {};
  } catch {
    // If we can't parse tsconfig, treat all flags as missing
    return { enabled: [], missing: [...strictFlags] };
  }

  const enabled: string[] = [];
  const missing: string[] = [];

  // If "strict" is true, it implies noImplicitAny, strictNullChecks,
  // strictPropertyInitialization (but not noImplicitReturns).
  const isStrictMode = compilerOptions['strict'] === true;

  for (const flag of strictFlags) {
    if (compilerOptions[flag] === true) {
      enabled.push(flag);
    } else if (flag !== 'strict' && isStrictMode && flag !== 'noImplicitReturns') {
      // strict: true implies these flags
      enabled.push(flag);
    } else {
      missing.push(flag);
    }
  }

  return { enabled, missing };
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'tsconfig.json'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Scanning for `any` type usage...');

    // 1. Find `any` usage: `: any`, `as any`, `<any>`
    const anyMatches = grepPattern(repoPath, ': any[^a-zA-Z]|: any$|as any[^a-zA-Z]|as any$|<any>');

    opts.onProgress?.(25, 'Checking tsconfig strict flags...');

    // 2. Check tsconfig strict flags
    const { enabled: enabledFlags, missing: missingFlags } = checkStrictFlags(repoPath);

    opts.onProgress?.(40, 'Scanning for type assertions...');

    // 3. Find type assertions: `as unknown as`, non-null assertions `!.`
    const castMatches = grepPattern(repoPath, 'as unknown as |!\\.');

    opts.onProgress?.(60, 'Scanning for ts-ignore / ts-expect-error...');

    // 4. Find @ts-ignore and @ts-expect-error comments
    const tsIgnoreMatches = grepPattern(repoPath, '@ts-ignore|@ts-expect-error');

    opts.onProgress?.(80, 'Computing score...');

    const anyCount = anyMatches.length;
    const assertionCount = castMatches.length;
    const tsIgnoreCount = tsIgnoreMatches.length;

    // Scoring
    let score = 100;

    // Deduct 2 points per `any` usage (cap at 40)
    const anyDeduction = Math.min(anyCount * 2, 40);
    score -= anyDeduction;

    // Deduct 5 points per missing strict flag
    const flagDeduction = missingFlags.length * 5;
    score -= flagDeduction;

    // Deduct 1 point per type assertion (cap at 15)
    const assertionDeduction = Math.min(assertionCount * 1, 15);
    score -= assertionDeduction;

    // Deduct 2 points per ts-ignore (cap at 15)
    const tsIgnoreDeduction = Math.min(tsIgnoreCount * 2, 15);
    score -= tsIgnoreDeduction;

    score = Math.max(0, score);

    // Build findings
    const findings: Finding[] = [];

    for (const m of anyMatches) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'medium' as Severity,
        filePath: m.file,
        line: m.line,
        message: `Usage of \`any\` type: ${m.text}`,
        category: 'any-usage',
        suggestion: 'Replace `any` with a specific type, `unknown`, or a generic parameter.',
      };
      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('type-safety', finding),
      });
    }

    for (const flag of missingFlags) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'high' as Severity,
        filePath: 'tsconfig.json',
        message: `Strict flag \`${flag}\` is not enabled.`,
        category: 'missing-strict-flag',
        suggestion: `Enable \`"${flag}": true\` in compilerOptions for stricter type checking.`,
      };
      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('type-safety', finding),
      });
    }

    for (const m of castMatches) {
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: 'low' as Severity,
        filePath: m.file,
        line: m.line,
        message: `Type assertion: ${m.text}`,
        category: 'type-assertion',
        suggestion: 'Consider using type guards or refactoring to avoid unsafe type assertions.',
      };
      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('type-safety', finding),
      });
    }

    for (const m of tsIgnoreMatches) {
      const isTsIgnore = m.text.includes('@ts-ignore');
      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity: isTsIgnore ? ('medium' as Severity) : ('low' as Severity),
        filePath: m.file,
        line: m.line,
        message: isTsIgnore
          ? `@ts-ignore suppresses all type errors on the next line.`
          : `@ts-expect-error used to suppress a type error.`,
        category: 'ts-directive',
        suggestion: isTsIgnore
          ? 'Prefer @ts-expect-error (fails if the error is fixed) or fix the underlying type issue.'
          : 'Consider fixing the underlying type issue instead of suppressing it.',
      };
      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('type-safety', finding),
      });
    }

    opts.onProgress?.(100, 'Type safety analysis complete.');

    const metrics: Record<string, number> = {
      anyCount,
      assertionCount,
      tsIgnoreCount,
      strictFlags: enabledFlags.length,
    };

    const parts: string[] = [];
    if (anyCount > 0) parts.push(`${anyCount} \`any\` usage(s)`);
    if (missingFlags.length > 0) parts.push(`${missingFlags.length} missing strict flag(s)`);
    if (assertionCount > 0) parts.push(`${assertionCount} type assertion(s)`);
    if (tsIgnoreCount > 0) parts.push(`${tsIgnoreCount} ts-ignore/ts-expect-error directive(s)`);

    const summary =
      parts.length === 0
        ? 'Excellent type safety: no issues found.'
        : `Type safety issues: ${parts.join(', ')}.`;

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
    id: 'type-safety',
    name: 'Type Safety',
    description: 'TypeScript type safety quality analysis',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
