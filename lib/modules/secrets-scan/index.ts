import { execSync } from 'child_process';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

// ---------------------------------------------------------------------------
// Secret detection patterns
// ---------------------------------------------------------------------------

interface SecretPattern {
  name: string;
  regex: string;
  severity: Severity;
  category: string;
  suggestion: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // Private keys — critical
  {
    name: 'Private Key',
    regex: '-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----',
    severity: 'critical',
    category: 'private-key',
    suggestion:
      'Remove the private key from source code immediately. Store it in a secrets manager or environment variable and add the file to .gitignore.',
  },
  // AWS access keys — high
  {
    name: 'AWS Access Key',
    regex: 'AKIA[0-9A-Z]{16}',
    severity: 'high',
    category: 'aws-key',
    suggestion:
      'Rotate this AWS access key immediately and use environment variables or IAM roles instead of hardcoded credentials.',
  },
  // Connection strings — high
  {
    name: 'Connection String',
    regex: '(mongodb|postgres|mysql|redis):\\/\\/[^\\s\'"]+',
    severity: 'high',
    category: 'connection-string',
    suggestion:
      'Move database connection strings to environment variables. Never commit credentials in connection URIs.',
  },
  // OpenAI / Anthropic API keys — high
  {
    name: 'OpenAI/Anthropic API Key',
    regex: 'sk-[a-zA-Z0-9]{20,}',
    severity: 'high',
    category: 'api-key',
    suggestion:
      'Remove this API key from source code and use an environment variable (e.g. OPENAI_API_KEY or ANTHROPIC_API_KEY).',
  },
  // GitHub PAT — high
  {
    name: 'GitHub Personal Access Token',
    regex: 'ghp_[a-zA-Z0-9]{36}',
    severity: 'high',
    category: 'api-key',
    suggestion:
      'Revoke this GitHub token immediately and use environment variables or GitHub App tokens instead.',
  },
  // Generic password/secret/token assignments — medium
  {
    name: 'Generic Secret Assignment',
    regex: "(password|secret|token|api_key|apikey|api-key|auth_token)\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",
    severity: 'medium',
    category: 'generic-secret',
    suggestion:
      'Move this secret to an environment variable or a secrets manager. Hardcoded secrets are a common source of credential leaks.',
  },
  // Base64-encoded secrets assigned to secret-like variable names — low
  {
    name: 'Possible Base64 Secret',
    regex: '(password|secret|token|key|credential|auth)\\s*[:=]\\s*[\'"][A-Za-z0-9+/]{40,}={0,2}[\'"]',
    severity: 'low',
    category: 'base64-secret',
    suggestion:
      'This looks like a base64-encoded credential. If it is a secret, move it to an environment variable.',
  },
];

// Deduction per severity level
const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

// Excluded directories and files for grep
const GREP_EXCLUDES = [
  '--exclude-dir=node_modules',
  '--exclude-dir=.git',
  '--exclude=package-lock.json',
  '--exclude=yarn.lock',
  '--exclude=*.min.js',
].join(' ');

// Files that look like test fixtures or example configs
const TEST_FIXTURE_PATTERNS = [
  /[/\\]__fixtures__[/\\]/,
  /[/\\]__mocks__[/\\]/,
  /[/\\]fixtures[/\\]/,
  /[/\\]test[_-]?data[/\\]/,
  /[/\\]testdata[/\\]/,
  /\.example(\.[^.]+)?$/,
  /\.sample(\.[^.]+)?$/,
  /\.template(\.[^.]+)?$/,
  /example\..*$/,
  /sample\..*$/,
  /\.env\.example$/,
  /\.env\.sample$/,
  /\.env\.template$/,
];

function isTestFixtureOrExample(filePath: string): boolean {
  return TEST_FIXTURE_PATTERNS.some((pattern) => pattern.test(filePath));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const runner: ModuleRunner = {
  async canRun(_repoPath: string): Promise<boolean> {
    // Any repo could have hardcoded secrets
    return true;
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Scanning for hardcoded secrets...');

    const findings: Finding[] = [];
    let score = 100;

    for (let i = 0; i < SECRET_PATTERNS.length; i++) {
      const pattern = SECRET_PATTERNS[i];

      opts.onProgress?.(
        5 + Math.round(((i + 1) / SECRET_PATTERNS.length) * 80),
        `Checking for ${pattern.name}...`
      );

      // Use case-insensitive flag for generic patterns
      const caseFlag =
        pattern.category === 'generic-secret' || pattern.category === 'base64-secret'
          ? '-i'
          : '';

      let stdout = '';
      try {
        stdout = execSync(
          `grep -rn ${caseFlag} -E ${JSON.stringify(pattern.regex)} ${GREP_EXCLUDES} .`,
          {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: 30_000,
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
      } catch {
        // grep exits non-zero when no matches found — that's expected
        continue;
      }

      if (!stdout.trim()) continue;

      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        // Parse grep output: ./path/to/file:lineNum:matchedLine
        const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
        if (!match) continue;

        const [, filePath, lineStr, matchedText] = match;
        const lineNum = parseInt(lineStr, 10);

        // Skip test fixtures and example configs
        if (isTestFixtureOrExample(filePath)) continue;

        // Truncate matched text for the message to avoid leaking the actual secret
        const truncated =
          matchedText.length > 120
            ? matchedText.slice(0, 120) + '...'
            : matchedText;
        const message = `${pattern.name} detected: ${truncated.trim()}`;

        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity: pattern.severity,
          filePath,
          line: lineNum,
          message,
          category: pattern.category,
          suggestion: pattern.suggestion,
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('secrets-scan', finding),
        });

        score -= SEVERITY_DEDUCTIONS[pattern.severity];
      }
    }

    // Floor at 0
    score = Math.max(0, score);

    opts.onProgress?.(90, 'Compiling results...');

    // Collect severity counts for metrics
    const metrics: Record<string, number> = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    };

    opts.onProgress?.(100, 'Secrets scan complete.');

    const parts: string[] = [];
    if (metrics.critical > 0) parts.push(`${metrics.critical} critical`);
    if (metrics.high > 0) parts.push(`${metrics.high} high`);
    if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
    if (metrics.low > 0) parts.push(`${metrics.low} low`);

    const summary =
      findings.length === 0
        ? 'No hardcoded secrets detected.'
        : `Found ${findings.length} potential secrets: ${parts.join(', ')}.`;

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
    id: 'secrets-scan',
    name: 'Secrets Scan',
    description: 'Detects hardcoded secrets, API keys, tokens, and credentials in source code',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
