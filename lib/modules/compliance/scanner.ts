import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding } from '../types';
import type { ComplianceRule } from './rules/hipaa';
import { tryLoadAstGrep, scanFiles } from '../shared/ast-scanner';

/**
 * Scan a repository for compliance violations matching a single rule.
 * Uses the shared ast-scanner infrastructure with @ast-grep/napi structural
 * pattern matching.
 */
export async function scanWithRule(
  repoPath: string,
  rule: ComplianceRule
): Promise<Finding[]> {
  const astGrep = tryLoadAstGrep();
  if (!astGrep) {
    // If ast-grep is not available, return empty (fail open with a warning)
    console.warn(
      '[compliance] @ast-grep/napi not available, skipping rule:',
      rule.id
    );
    return [];
  }

  const matches = scanFiles(repoPath, rule, astGrep);

  const findings: Finding[] = [];

  for (const match of matches) {
    const message = `[${rule.hipaaRef}] ${rule.message}`;

    const findingData: Omit<Finding, 'id' | 'fingerprint'> = {
      severity: rule.severity,
      filePath: match.relativePath,
      line: match.line,
      message,
      category: rule.hipaaCategory,
      suggestion: rule.suggestion,
    };

    findings.push({
      ...findingData,
      id: nanoid(),
      fingerprint: generateFingerprint('compliance-hipaa', findingData),
    });
  }

  return findings;
}
