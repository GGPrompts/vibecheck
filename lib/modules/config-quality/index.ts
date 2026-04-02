import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

const MODULE_ID = 'config-quality';

const severityDeductions: Record<Severity, number> = {
  critical: 15,
  high: 8,
  medium: 5,
  low: 2,
  info: 1,
};

function getArchetype(opts: RunOptions): string | null {
  return opts.autoDetect?.detectedArchetype ?? null;
}

function isPrototypeLike(archetype: string | null): boolean {
  return archetype === 'prototype';
}

function softenSeverity(severity: Severity, archetype: string | null): Severity {
  if (!isPrototypeLike(archetype)) return severity;
  switch (severity) {
    case 'critical':
      return 'high';
    case 'high':
      return 'medium';
    case 'medium':
      return 'low';
    case 'low':
      return 'info';
    case 'info':
      return 'info';
  }
}

function makeFinding(
  severity: Severity,
  filePath: string,
  message: string,
  category: string,
  suggestion?: string
): Finding {
  const partial = { severity, filePath, message, category, suggestion };
  return {
    ...partial,
    id: nanoid(),
    fingerprint: generateFingerprint(MODULE_ID, partial),
  };
}

function readJsonSafe(filePath: string, stripComments = false): Record<string, unknown> | null {
  try {
    let raw = readFileSync(filePath, 'utf-8');
    if (stripComments) {
      raw = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    }
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Individual checkers
// ---------------------------------------------------------------------------

function checkTsconfig(repoPath: string): Finding[] {
  const findings: Finding[] = [];
  const tsconfigPath = join(repoPath, 'tsconfig.json');

  if (!existsSync(tsconfigPath)) {
    // Not every project uses TypeScript — skip silently.
    return findings;
  }

  const tsconfig = readJsonSafe(tsconfigPath, true);
  if (!tsconfig) {
    findings.push(
      makeFinding(
        'medium',
        'tsconfig.json',
        'tsconfig.json exists but could not be parsed as valid JSON',
        'tsconfig',
        'Fix JSON syntax errors in tsconfig.json.'
      )
    );
    return findings;
  }

  const compilerOptions =
    (tsconfig.compilerOptions as Record<string, unknown>) ?? {};

  if (!compilerOptions.strict) {
    findings.push(
      makeFinding(
        'medium',
        'tsconfig.json',
        'TypeScript strict mode is not enabled',
        'tsconfig',
        'Set "strict": true in compilerOptions for stronger type safety.'
      )
    );
  }

  const importantFlags: Array<{ flag: string; suggestion: string }> = [
    {
      flag: 'noImplicitAny',
      suggestion:
        'Enable "noImplicitAny" to catch implicit any types, or enable "strict" which includes it.',
    },
    {
      flag: 'strictNullChecks',
      suggestion:
        'Enable "strictNullChecks" to catch null/undefined issues, or enable "strict" which includes it.',
    },
    {
      flag: 'esModuleInterop',
      suggestion:
        'Enable "esModuleInterop" for cleaner CommonJS/ESM interop.',
    },
    {
      flag: 'skipLibCheck',
      suggestion:
        'Enable "skipLibCheck" to speed up compilation by skipping type checks on declaration files.',
    },
  ];

  // If strict is true, noImplicitAny and strictNullChecks are implied.
  const strictEnabled = compilerOptions.strict === true;

  for (const { flag, suggestion } of importantFlags) {
    // Skip flags implied by strict: true
    if (
      strictEnabled &&
      (flag === 'noImplicitAny' || flag === 'strictNullChecks')
    ) {
      continue;
    }

    if (compilerOptions[flag] === undefined) {
      findings.push(
        makeFinding('info', 'tsconfig.json', `Missing "${flag}" in compilerOptions`, 'tsconfig', suggestion)
      );
    }
  }

  return findings;
}

function checkPackageJson(repoPath: string, archetype: string | null): Finding[] {
  const findings: Finding[] = [];
  const pkgPath = join(repoPath, 'package.json');

  if (!existsSync(pkgPath)) {
    // Not a Node.js project — skip silently.
    return findings;
  }

  const pkg = readJsonSafe(pkgPath);
  if (!pkg) {
    findings.push(
      makeFinding(
        'high',
        'package.json',
        'package.json exists but could not be parsed as valid JSON',
        'package-json',
        'Fix JSON syntax errors in package.json.'
      )
    );
    return findings;
  }

  if (!pkg.description) {
    findings.push(
      makeFinding(
        softenSeverity('low', archetype),
        'package.json',
        archetype === 'prototype'
          ? 'Missing "description" field in package.json. Prototypes can be rough, but a short description still helps future contributors and agents understand the repo shape.'
          : 'Missing "description" field in package.json. This matters for shared packages, CLIs, and services because the metadata is the first clue consumers and agents see.',
        'package-json',
        'Add a brief project description to package.json so consumers and agents can tell what the repo is for.'
      )
    );
  }

  if (!pkg.license) {
    findings.push(
      makeFinding(
        softenSeverity('low', archetype),
        'package.json',
        archetype === 'prototype'
          ? 'Missing "license" field in package.json. This is easy to defer in a throwaway prototype, but it matters once the repo is shared or published.'
          : 'Missing "license" field in package.json. This matters for reusable packages and internal tooling because downstream consumers need to know how the code may be used.',
        'package-json',
        'Specify a license (e.g., "MIT", "Apache-2.0") in package.json.'
      )
    );
  }

  if (!pkg.engines) {
    findings.push(
      makeFinding(
        softenSeverity('info', archetype),
        'package.json',
        archetype === 'prototype'
          ? 'Missing "engines" field in package.json. That is optional for a prototype, but it becomes important once you want reproducible installs or CI.'
          : 'Missing "engines" field in package.json. This matters for CLIs, libraries, and services because runtime version mismatches are a common source of "works on my machine" bugs.',
        'package-json',
        'Define the Node.js version range in "engines" to avoid compatibility surprises.'
      )
    );
  }

  // Check for lint/test/build scripts
  const scripts = (pkg.scripts as Record<string, string>) ?? {};
  const scriptKeys = Object.keys(scripts);

  const hasLint = scriptKeys.some((k) =>
    /^lint/i.test(k) || /eslint|biome|oxlint/i.test(scripts[k] ?? '')
  );
  if (!hasLint) {
    findings.push(
      makeFinding(
        softenSeverity('info', archetype),
        'package.json',
        archetype === 'prototype'
          ? 'No lint script found in package.json. That is usually acceptable for a prototype, but it becomes valuable once the repo starts getting contributions.'
          : 'No lint script found in package.json. This matters for packages, CLIs, and services because automated linting keeps the codebase stable for humans and agents.',
        'package-json',
        'Add a "lint" script to enforce code style automatically.'
      )
    );
  }

  const hasTest = scriptKeys.some((k) =>
    /^test/i.test(k) && !/no test/.test(scripts[k] ?? '')
  );
  if (!hasTest) {
    findings.push(
      makeFinding(
        softenSeverity('info', archetype),
        'package.json',
        archetype === 'prototype'
          ? 'No test script found in package.json. A prototype can skip a test harness temporarily, but the gap should be closed before the repo becomes reusable.'
          : 'No test script found in package.json. This matters for reusable packages, CLIs, and services because tests are the cheapest regression guard.',
        'package-json',
        'Add a "test" script to run your test suite.'
      )
    );
  }

  const hasBuild = scriptKeys.some((k) => /^build/i.test(k));
  if (!hasBuild) {
    findings.push(
      makeFinding(
        softenSeverity('info', archetype),
        'package.json',
        archetype === 'prototype'
          ? 'No build script found in package.json. Prototypes can defer a build step, but that usually changes once the repo needs repeatable releases or CI.'
          : 'No build script found in package.json. This matters for packages, CLIs, and deployable services because it gives CI and other tools one stable entrypoint.',
        'package-json',
        'Add a "build" script if your project requires a compilation step.'
      )
    );
  }

  // Check for wildcard version ranges
  const depsGroups: Array<[string, Record<string, string>]> = [
    ['dependencies', (pkg.dependencies as Record<string, string>) ?? {}],
    [
      'devDependencies',
      (pkg.devDependencies as Record<string, string>) ?? {},
    ],
  ];

  for (const [groupName, deps] of depsGroups) {
    for (const [name, version] of Object.entries(deps)) {
      if (version === '*' || version === 'latest') {
        findings.push(
          makeFinding(
            'high',
            'package.json',
            `Wildcard version "${version}" for "${name}" in ${groupName}`,
            'package-json',
            `Pin "${name}" to a specific semver range (e.g., "^1.0.0") to avoid breaking changes.`
          )
        );
      }
    }
  }

  return findings;
}

function checkEslintConfig(repoPath: string): Finding[] {
  const findings: Finding[] = [];

  const eslintConfigs = [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
    'eslint.config.mts',
    'eslint.config.cts',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    '.eslintrc',
  ];

  const hasEslint = eslintConfigs.some((f) =>
    existsSync(join(repoPath, f))
  );

  // Also check package.json for eslintConfig key
  let hasEslintInPkg = false;
  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = readJsonSafe(pkgPath);
    if (pkg && pkg.eslintConfig) {
      hasEslintInPkg = true;
    }
  }

  // Also check for biome as an alternative linter
  const hasBiome = existsSync(join(repoPath, 'biome.json')) ||
    existsSync(join(repoPath, 'biome.jsonc'));

  if (!hasEslint && !hasEslintInPkg && !hasBiome) {
    findings.push(
      makeFinding(
        'medium',
        '.',
        'No ESLint (or Biome) configuration found',
        'eslint',
        'Add an ESLint config file (eslint.config.js) or biome.json to enforce consistent code style.'
      )
    );
  }

  return findings;
}

function checkGitignore(repoPath: string): Finding[] {
  const findings: Finding[] = [];
  const gitignorePath = join(repoPath, '.gitignore');

  if (!existsSync(gitignorePath)) {
    findings.push(
      makeFinding(
        'high',
        '.gitignore',
        'No .gitignore file found',
        'gitignore',
        'Create a .gitignore to prevent committing build artifacts, secrets, and dependencies.'
      )
    );
    return findings;
  }

  let content: string;
  try {
    content = readFileSync(gitignorePath, 'utf-8');
  } catch {
    return findings;
  }

  const lines = content.split('\n').map((l) => l.trim());

  const expectedPatterns: Array<{
    pattern: RegExp;
    label: string;
    suggestion: string;
  }> = [
    {
      pattern: /^node_modules\/?$/,
      label: 'node_modules',
      suggestion: 'Add "node_modules" to .gitignore to exclude dependencies.',
    },
    {
      pattern: /^\.env$/,
      label: '.env',
      suggestion:
        'Add ".env" to .gitignore to prevent committing secrets.',
    },
    {
      pattern: /^(dist|build)\/?$/,
      label: 'dist/build',
      suggestion:
        'Add "dist" or "build" to .gitignore to exclude compiled output.',
    },
  ];

  for (const { pattern, label, suggestion } of expectedPatterns) {
    const found = lines.some((line) => pattern.test(line));
    if (!found) {
      findings.push(
        makeFinding(
          'info',
          '.gitignore',
          `.gitignore does not include "${label}"`,
          'gitignore',
          suggestion
        )
      );
    }
  }

  return findings;
}

function checkEnvExample(repoPath: string): Finding[] {
  const findings: Finding[] = [];

  const hasEnv = existsSync(join(repoPath, '.env'));
  const hasEnvExample =
    existsSync(join(repoPath, '.env.example')) ||
    existsSync(join(repoPath, '.env.sample')) ||
    existsSync(join(repoPath, '.env.template'));

  if (hasEnv && !hasEnvExample) {
    findings.push(
      makeFinding(
        'medium',
        '.env',
        'Found .env file but no .env.example template',
        'env',
        'Create a .env.example with placeholder values so contributors know which variables are needed.'
      )
    );
  }

  return findings;
}

function checkDockerfile(repoPath: string): Finding[] {
  const findings: Finding[] = [];
  const dockerfilePath = join(repoPath, 'Dockerfile');

  if (!existsSync(dockerfilePath)) {
    return findings;
  }

  let content: string;
  try {
    content = readFileSync(dockerfilePath, 'utf-8');
  } catch {
    return findings;
  }

  // Check if running as root (no USER directive)
  const lines = content.split('\n').map((l) => l.trim());
  const hasUserDirective = lines.some((l) => /^USER\s+/i.test(l));
  if (!hasUserDirective) {
    findings.push(
      makeFinding(
        'medium',
        'Dockerfile',
        'Dockerfile does not set a non-root USER',
        'docker',
        'Add a USER directive to run the container as a non-root user for better security.'
      )
    );
  }

  // Check for .dockerignore
  if (!existsSync(join(repoPath, '.dockerignore'))) {
    findings.push(
      makeFinding(
        'low',
        'Dockerfile',
        'Dockerfile exists but no .dockerignore found',
        'docker',
        'Create a .dockerignore to exclude unnecessary files from the Docker build context.'
      )
    );
  }

  return findings;
}

function checkCiConfig(repoPath: string, archetype: string | null): Finding[] {
  const findings: Finding[] = [];

  const ciPaths = [
    join(repoPath, '.github', 'workflows'),
    join(repoPath, '.gitlab-ci.yml'),
    join(repoPath, '.circleci'),
    join(repoPath, 'Jenkinsfile'),
    join(repoPath, '.travis.yml'),
    join(repoPath, 'azure-pipelines.yml'),
    join(repoPath, 'bitbucket-pipelines.yml'),
  ];

  let hasCi = false;

  for (const ciPath of ciPaths) {
    if (existsSync(ciPath)) {
      // For directories (like .github/workflows), verify it contains files
      try {
        readFileSync(ciPath, 'utf-8');
        // If readFileSync succeeds, it's a file
        hasCi = true;
        break;
      } catch {
        // It's a directory — check if it has files
        try {
          const entries = readdirSync(ciPath);
          if (entries.length > 0) {
            hasCi = true;
            break;
          }
        } catch {
          // Can't read directory
        }
      }
    }
  }

  if (!hasCi && archetype !== 'prototype') {
    findings.push(
      makeFinding(
        'medium',
        '.',
        'No CI/CD configuration found. This matters for shared packages, CLIs, and services because automated checks catch regressions before they ship.',
        'ci',
        'Add a CI config (e.g., .github/workflows/) to automate testing and deployment.'
      )
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Module runner
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    return true;
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Checking configuration files...');

    const archetype = getArchetype(opts);
    const findings: Finding[] = [];

    opts.onProgress?.(10, 'Checking tsconfig.json...');
    findings.push(...checkTsconfig(repoPath));

    opts.onProgress?.(25, 'Checking package.json...');
    findings.push(...checkPackageJson(repoPath, archetype));

    opts.onProgress?.(40, 'Checking ESLint config...');
    findings.push(...checkEslintConfig(repoPath));

    opts.onProgress?.(55, 'Checking .gitignore...');
    findings.push(...checkGitignore(repoPath));

    opts.onProgress?.(65, 'Checking .env.example...');
    findings.push(...checkEnvExample(repoPath));

    opts.onProgress?.(75, 'Checking Dockerfile...');
    findings.push(...checkDockerfile(repoPath));

    opts.onProgress?.(85, 'Checking CI configuration...');
    findings.push(...checkCiConfig(repoPath, archetype));

    // Calculate score
    let score = 100;
    for (const finding of findings) {
      const deduction = severityDeductions[finding.severity] ?? 0;
      score -= deduction;
    }
    score = Math.max(0, score);

    // Collect metrics
    const metrics: Record<string, number> = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };

    opts.onProgress?.(100, 'Config quality check complete.');

    // Build summary
    const parts: string[] = [];
    if (metrics.high > 0) parts.push(`${metrics.high} high`);
    if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
    if (metrics.low > 0) parts.push(`${metrics.low} low`);
    if (metrics.info > 0) parts.push(`${metrics.info} info`);

    const summary =
      findings.length === 0
        ? 'All configuration files look good.'
        : `Found ${findings.length} config quality issues: ${parts.join(', ')}.`;

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
    id: 'config-quality',
    name: 'Config Quality',
    description:
      'Audits project configuration files (tsconfig, package.json, ESLint, .gitignore, Docker, CI) for completeness and best practices.',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
