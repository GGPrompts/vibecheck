import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface CargoAuditVulnerability {
  advisory: {
    id: string;
    title: string;
    url?: string;
    severity?: string;
  };
  package: {
    name: string;
    version: string;
  };
}

interface CargoAuditOutput {
  vulnerabilities: {
    found: boolean;
    count: number;
    list: CargoAuditVulnerability[];
  };
}

function mapSeverity(severity: string | undefined): Severity {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

const severityDeductions: Record<string, number> = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return existsSync(join(repoPath, 'Cargo.toml'));
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running cargo audit...');

    let stdout = '';
    try {
      stdout = execSync('cargo audit --json', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      // cargo audit exits non-zero when vulnerabilities are found
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
            summary: 'cargo-audit is not installed. Install with: cargo install cargo-audit',
          };
        }
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `cargo audit failed: ${msg}`,
        };
      }
    }

    if (!stdout.trim()) {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { total: 0 },
        summary: 'No vulnerabilities found (empty audit output).',
      };
    }

    let auditData: CargoAuditOutput;
    try {
      auditData = JSON.parse(stdout);
    } catch {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Failed to parse cargo audit JSON output.',
      };
    }

    opts.onProgress?.(50, 'Parsing audit results...');

    const findings: Finding[] = [];
    let score = 100;

    const vulnList = auditData.vulnerabilities?.list ?? [];
    for (const vuln of vulnList) {
      const severity = mapSeverity(vuln.advisory.severity);
      const deduction = severityDeductions[severity] ?? 0;
      score -= deduction;

      const message = vuln.advisory.url
        ? `${vuln.advisory.title} (${vuln.package.name}@${vuln.package.version}) — ${vuln.advisory.url}`
        : `${vuln.advisory.title} (${vuln.package.name}@${vuln.package.version})`;

      const finding: Omit<Finding, 'id' | 'fingerprint'> = {
        severity,
        filePath: 'Cargo.toml',
        message,
        category: 'vulnerability',
        suggestion: `Update ${vuln.package.name} to a patched version. Advisory: ${vuln.advisory.id}`,
      };

      findings.push({
        ...finding,
        id: nanoid(),
        fingerprint: generateFingerprint('rust-security', finding),
      });
    }

    score = Math.max(0, score);

    const metrics: Record<string, number> = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };

    opts.onProgress?.(100, 'Rust security scan complete.');

    const parts: string[] = [];
    if (metrics.critical > 0) parts.push(`${metrics.critical} critical`);
    if (metrics.high > 0) parts.push(`${metrics.high} high`);
    if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
    if (metrics.low > 0) parts.push(`${metrics.low} low`);

    const summary =
      findings.length === 0
        ? 'No known vulnerabilities found in Rust dependencies.'
        : `Found ${findings.length} vulnerabilities: ${parts.join(', ')}.`;

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
    id: 'rust-security',
    name: 'Rust Security',
    description: 'Known vulnerability scanning via cargo audit',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
