import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

interface NpmAuditAdvisory {
  severity: string;
  module_name?: string;
  title?: string;
  url?: string;
  overview?: string;
  findings?: Array<{ version: string; paths: string[] }>;
}

interface NpmAuditV2Vulnerability {
  name: string;
  severity: string;
  via: Array<string | { title?: string; url?: string; severity?: string }>;
  effects: string[];
  range: string;
  fixAvailable: boolean | Record<string, unknown>;
}

interface NpmAuditOutput {
  // v1 format
  advisories?: Record<string, NpmAuditAdvisory>;
  // v2 format
  vulnerabilities?: Record<string, NpmAuditV2Vulnerability>;
  metadata?: {
    vulnerabilities?: Record<string, number>;
    totalDependencies?: number;
  };
}

const severityDeductions: Record<string, number> = {
  critical: 20,
  high: 10,
  moderate: 5,
  low: 2,
  info: 0,
};

function mapSeverity(npmSeverity: string): Severity {
  switch (npmSeverity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    return (
      existsSync(join(repoPath, 'package-lock.json')) ||
      existsSync(join(repoPath, 'yarn.lock'))
    );
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(10, 'Running npm audit...');

    let stdout = '';
    try {
      stdout = execSync('npm audit --json', {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      // npm audit exits non-zero when vulnerabilities are found -- that's normal.
      // We still want to parse stdout.
      if (
        error &&
        typeof error === 'object' &&
        'stdout' in error &&
        typeof (error as { stdout: unknown }).stdout === 'string'
      ) {
        stdout = (error as { stdout: string }).stdout;
      } else {
        // Genuine failure (npm not available, etc.)
        return {
          score: -1,
          confidence: 0,
          findings: [],
          metrics: {},
          summary: `npm audit failed: ${error instanceof Error ? error.message : String(error)}`,
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

    let auditData: NpmAuditOutput;
    try {
      auditData = JSON.parse(stdout);
    } catch {
      return {
        score: -1,
        confidence: 0,
        findings: [],
        metrics: {},
        summary: 'Failed to parse npm audit JSON output.',
      };
    }

    opts.onProgress?.(50, 'Parsing audit results...');

    const findings: Finding[] = [];
    let score = 100;

    // Handle npm audit v2 format (npm >= 7)
    if (auditData.vulnerabilities) {
      for (const [pkgName, vuln] of Object.entries(auditData.vulnerabilities)) {
        const severity = mapSeverity(vuln.severity);
        const deduction = severityDeductions[vuln.severity] ?? 0;
        score -= deduction;

        // Extract advisory info from 'via' entries
        const advisoryInfos = vuln.via.filter(
          (v): v is { title?: string; url?: string; severity?: string } =>
            typeof v !== 'string'
        );
        const title =
          advisoryInfos[0]?.title ?? `Vulnerability in ${pkgName}`;
        const url = advisoryInfos[0]?.url ?? '';

        const message = url
          ? `${title} (${pkgName}) — ${url}`
          : `${title} (${pkgName})`;

        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity,
          filePath: 'package.json',
          message,
          category: 'vulnerability',
          suggestion: vuln.fixAvailable
            ? `Run \`npm audit fix\` to resolve.`
            : `No automatic fix available. Review ${url || 'the advisory'} for manual remediation.`,
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('security', finding),
        });
      }
    }
    // Handle npm audit v1 format (npm < 7)
    else if (auditData.advisories) {
      for (const advisory of Object.values(auditData.advisories)) {
        const severity = mapSeverity(advisory.severity);
        const deduction = severityDeductions[advisory.severity] ?? 0;
        score -= deduction;

        const message = advisory.url
          ? `${advisory.title ?? 'Vulnerability'} (${advisory.module_name ?? 'unknown'}) — ${advisory.url}`
          : `${advisory.title ?? 'Vulnerability'} (${advisory.module_name ?? 'unknown'})`;

        const finding: Omit<Finding, 'id' | 'fingerprint'> = {
          severity,
          filePath: 'package.json',
          message,
          category: 'vulnerability',
          suggestion: `Review the advisory and update the affected package.`,
        };

        findings.push({
          ...finding,
          id: nanoid(),
          fingerprint: generateFingerprint('security', finding),
        });
      }
    }

    score = Math.max(0, score);

    // Collect severity counts for metrics
    const metrics: Record<string, number> = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };

    opts.onProgress?.(100, 'Security scan complete.');

    const parts: string[] = [];
    if (metrics.critical > 0) parts.push(`${metrics.critical} critical`);
    if (metrics.high > 0) parts.push(`${metrics.high} high`);
    if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
    if (metrics.low > 0) parts.push(`${metrics.low} low`);

    const summary =
      findings.length === 0
        ? 'No known vulnerabilities found.'
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
    id: 'security',
    name: 'Security',
    description: 'Known vulnerability scanning via npm audit',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
