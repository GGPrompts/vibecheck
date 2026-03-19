import { registerModule } from '../registry';
import type { ModuleRunner, ModuleResult, RunOptions, Finding } from '../types';
import { hipaaRules } from './rules/hipaa';
import type { ComplianceRule } from './rules/hipaa';
import { scanWithRule } from './scanner';

/**
 * Severity deductions for scoring. More severe findings reduce the score more.
 */
const severityDeductions: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 5,
  low: 2,
  info: 0,
};

/**
 * Generic compliance module runner.
 *
 * Loads a set of compliance rules (defined as TypeScript objects) and runs
 * them against the codebase using ast-grep's structural pattern matching.
 *
 * Each rule defines:
 * - pattern: an ast-grep structural pattern to match
 * - severity: how serious the finding is
 * - hipaaCategory: which HIPAA rule category applies
 * - message: human-readable description of the issue
 * - suggestion: recommended fix
 */
function createComplianceRunner(rules: ComplianceRule[]): ModuleRunner {
  return {
    async canRun(_repoPath: string): Promise<boolean> {
      // Compliance scanning applies to any repository
      return true;
    },

    async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
      opts.onProgress?.(5, 'Starting HIPAA compliance scan...');

      const allFindings: Finding[] = [];
      const totalRules = rules.length;

      for (let i = 0; i < totalRules; i++) {
        const rule = rules[i];

        // Check for abort
        if (opts.signal?.aborted) {
          break;
        }

        // Report progress
        const pct = Math.round(5 + (90 * (i + 1)) / totalRules);
        opts.onProgress?.(pct, `Scanning rule: ${rule.name}`);

        try {
          const findings = await scanWithRule(repoPath, rule);
          allFindings.push(...findings);
        } catch (err) {
          // Log but don't fail the entire scan for one rule
          console.warn(
            `[compliance] Rule "${rule.id}" failed:`,
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      // Deduplicate findings by fingerprint (multiple rules may match the same code)
      const seen = new Set<string>();
      const deduped = allFindings.filter((f) => {
        if (seen.has(f.fingerprint)) return false;
        seen.add(f.fingerprint);
        return true;
      });

      // Calculate score
      let score = 100;
      for (const finding of deduped) {
        const deduction = severityDeductions[finding.severity] ?? 0;
        score -= deduction;
      }
      score = Math.max(0, score);

      // Collect metrics
      const metrics: Record<string, number> = {
        total: deduped.length,
        critical: deduped.filter((f) => f.severity === 'critical').length,
        high: deduped.filter((f) => f.severity === 'high').length,
        medium: deduped.filter((f) => f.severity === 'medium').length,
        low: deduped.filter((f) => f.severity === 'low').length,
        info: deduped.filter((f) => f.severity === 'info').length,
        rulesChecked: totalRules,
      };

      opts.onProgress?.(100, 'HIPAA compliance scan complete.');

      // Build summary
      const parts: string[] = [];
      if (metrics.critical > 0) parts.push(`${metrics.critical} critical`);
      if (metrics.high > 0) parts.push(`${metrics.high} high`);
      if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
      if (metrics.low > 0) parts.push(`${metrics.low} low`);

      const summary =
        deduped.length === 0
          ? `No HIPAA compliance issues found (${totalRules} rules checked).`
          : `Found ${deduped.length} HIPAA compliance issues: ${parts.join(', ')}. (${totalRules} rules checked)`;

      return {
        score,
        confidence: 0.8, // Structural pattern matching may have false positives
        findings: deduped,
        metrics,
        summary,
      };
    },
  };
}

// Create and register the HIPAA compliance module
const runner = createComplianceRunner(hipaaRules);

registerModule(
  {
    id: 'compliance-hipaa',
    name: 'HIPAA Compliance',
    description:
      'Scans source code for potential HIPAA violations using structural pattern matching (ast-grep). Detects PHI exposure in logs, responses, storage, and missing audit controls.',
    category: 'static',
    defaultEnabled: false,
  },
  runner
);
