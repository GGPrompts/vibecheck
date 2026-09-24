import { nanoid } from 'nanoid';
import { generateFingerprint } from '../fingerprint';
import type { Finding } from '../types';
import type { ComplianceRule } from './rules/hipaa';
import { tryLoadAstGrep, scanFilesWithRules } from '../shared/ast-scanner';

/**
 * Scan a repository for compliance violations against a set of rules in one
 * pass over the source tree (each file parsed once, not once per rule).
 * Uses the shared ast-scanner infrastructure with @ast-grep/napi structural
 * pattern matching.
 */
export async function scanWithRules(
  repoPath: string,
  rules: ComplianceRule[]
): Promise<Finding[]> {
  const astGrep = tryLoadAstGrep();
  if (!astGrep) {
    // If ast-grep is not available, return empty (fail open with a warning)
    console.warn(
      '[compliance] @ast-grep/napi not available, skipping',
      rules.length,
      'rules'
    );
    return [];
  }

  const matchesByRule = scanFilesWithRules(repoPath, rules, astGrep);
  const findings: Finding[] = [];

  for (const rule of rules) {
    for (const match of matchesByRule.get(rule.id) ?? []) {
      findings.push(matchToFinding(rule, match));
    }
  }

  return findings;
}

/** Scan a repository against a single rule. */
export async function scanWithRule(
  repoPath: string,
  rule: ComplianceRule
): Promise<Finding[]> {
  return scanWithRules(repoPath, [rule]);
}

function matchToFinding(
  rule: ComplianceRule,
  match: { relativePath: string; line: number }
): Finding {
  {
    const message = `[${rule.hipaaRef}] ${rule.message}`;

    const findingData: Omit<Finding, 'id' | 'fingerprint'> = {
      severity: rule.severity,
      filePath: match.relativePath,
      line: match.line,
      message,
      category: rule.hipaaCategory,
      suggestion: rule.suggestion,
    };

    return {
      ...findingData,
      id: nanoid(),
      fingerprint: generateFingerprint('compliance-hipaa', findingData),
    };
  }
}
