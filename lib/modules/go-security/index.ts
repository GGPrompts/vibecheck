import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface GovulncheckVuln {
  osv?: {
    id?: string;
    summary?: string;
    details?: string;
    database_specific?: {
      severity?: string;
      url?: string;
    };
  };
  modules?: Array<{
    path?: string;
    found_version?: string;
    fixed_version?: string;
    packages?: Array<{
      path?: string;
      callstacks?: Array<{ summary?: string }>;
    }>;
  }>;
}

interface GovulncheckOutput {
  vulns?: GovulncheckVuln[];
}

function classifySeverity(vuln: GovulncheckVuln): Severity {
  const sev = vuln.osv?.database_specific?.severity?.toLowerCase();
  if (sev === 'critical') return 'critical';
  if (sev === 'high') return 'high';
  if (sev === 'medium' || sev === 'moderate') return 'medium';
  if (sev === 'low') return 'low';
  // If govulncheck matched call stacks, treat as high by default
  const hasCallstacks = vuln.modules?.some((m) =>
    m.packages?.some((p) => (p.callstacks?.length ?? 0) > 0)
  );
  return hasCallstacks ? 'high' : 'medium';
}

const severityDeductions: Record<Severity, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

function tryInstallGovulncheck(): boolean {
  try {
    execSync('go install golang.org/x/vuln/cmd/govulncheck@latest', {
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'go.mod'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running govulncheck...');

    // Check if govulncheck is available
    let govulncheckAvailable = false;
    try {
      execSync('which govulncheck', {
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      govulncheckAvailable = true;
    } catch {
      // Not in PATH, try installing
      opts.onProgress?.(15, 'Installing govulncheck...');
      govulncheckAvailable = tryInstallGovulncheck();
    }

    if (!govulncheckAvailable) {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary:
          'govulncheck not installed. Install with: go install golang.org/x/vuln/cmd/govulncheck@latest',
      };
    }

    let stdout = '';
    try {
      stdout = execSync('govulncheck -json ./...', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      // govulncheck exits non-zero when vulnerabilities are found
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
          summary: `govulncheck failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (!stdout.trim()) {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { total: 0 },
        summary: 'No vulnerabilities found.',
      };
    }

    opts.onProgress?.(50, 'Parsing vulnerability results...');

    // govulncheck -json outputs newline-delimited JSON messages.
    // We look for objects with an "osv" field indicating a vulnerability.
    let parsed: GovulncheckOutput;
    try {
      // Try parsing as a single JSON object first
      parsed = JSON.parse(stdout);
    } catch {
      // govulncheck outputs newline-delimited JSON messages; collect vuln entries
      const vulns: GovulncheckVuln[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed);
          if (obj.osv) {
            vulns.push(obj);
          }
        } catch {
          // Skip unparseable lines
        }
      }
      parsed = { vulns };
    }

    const findings: Finding[] = [];
    let score = 100;

    const vulns = parsed.vulns ?? [];
    for (const vuln of vulns) {
      const severity = classifySeverity(vuln);
      score -= severityDeductions[severity];

      const osvId = vuln.osv?.id ?? 'unknown';
      const summary = vuln.osv?.summary ?? 'Go vulnerability';
      const modulePath = vuln.modules?.[0]?.path ?? 'unknown';
      const fixedVersion = vuln.modules?.[0]?.fixed_version;

      const message = `${osvId}: ${summary} (${modulePath})`;
      const suggestion = fixedVersion
        ? `Update ${modulePath} to ${fixedVersion}`
        : `Review ${osvId} and update the affected dependency.`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath: 'go.mod',
        message,
        category: 'vulnerability',
        suggestion,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('go-security', finding),
      });
    }

    score = Math.max(0, score);

    const metrics: Record<string, number> = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    };

    opts.onProgress?.(100, 'Go security scan complete.');

    const parts: string[] = [];
    if (metrics.critical > 0) parts.push(`${metrics.critical} critical`);
    if (metrics.high > 0) parts.push(`${metrics.high} high`);
    if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
    if (metrics.low > 0) parts.push(`${metrics.low} low`);

    const summaryText =
      findings.length === 0
        ? 'No known vulnerabilities found.'
        : `Found ${findings.length} vulnerabilities: ${parts.join(', ')}.`;

    return {
      score,
      confidence: 1.0,
      findings,
      metrics,
      summary: summaryText,
    };
  },
};

registerModule(
  {
    id: 'go-security',
    name: 'Go Security',
    description: 'Known vulnerability scanning via govulncheck',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
