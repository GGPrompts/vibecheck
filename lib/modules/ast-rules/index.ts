import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { parse as parseYaml } from 'yaml';
import { nanoid } from 'nanoid';
import { registerModule } from '../registry';
import { generateFingerprint } from '../fingerprint';
import { tryLoadAstGrep, scanFiles } from '../shared/ast-scanner';
import type { ModuleRunner, ModuleResult, RunOptions, Finding, Severity } from '../types';

/**
 * Schema for a YAML-defined ast-grep rule.
 *
 * Fields:
 *   id        - Unique identifier for the rule
 *   name      - Human-readable name
 *   pattern   - ast-grep structural pattern
 *   language  - Target language: 'typescript' | 'javascript' | 'tsx' | 'python'
 *   severity  - critical | high | medium | low | info
 *   message   - Description of the issue when the pattern matches
 *   suggestion - Recommended fix (optional)
 *   category  - Grouping category (e.g., 'code-quality', 'security', 'performance')
 */
interface YamlRule {
  id: string;
  name: string;
  pattern: string;
  language: string;
  severity: Severity;
  message: string;
  suggestion?: string;
  category: string;
}

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
]);

/**
 * Validate a parsed YAML object against the YamlRule schema.
 * Returns an error string if invalid, or null if valid.
 */
function validateRule(raw: unknown, filePath: string): string | null {
  if (!raw || typeof raw !== 'object') {
    return `${filePath}: rule is not an object`;
  }

  const obj = raw as Record<string, unknown>;

  for (const field of ['id', 'name', 'pattern', 'language', 'severity', 'message', 'category']) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      return `${filePath}: missing or empty required field "${field}"`;
    }
  }

  if (!VALID_SEVERITIES.has(obj.severity as string)) {
    return `${filePath}: invalid severity "${obj.severity}" (expected: ${[...VALID_SEVERITIES].join(', ')})`;
  }

  if (!VALID_LANGUAGES.has((obj.language as string).toLowerCase())) {
    return `${filePath}: unsupported language "${obj.language}" (expected: ${[...VALID_LANGUAGES].join(', ')})`;
  }

  if (obj.suggestion !== undefined && typeof obj.suggestion !== 'string') {
    return `${filePath}: "suggestion" must be a string`;
  }

  return null;
}

/**
 * Load YAML rule files from a directory.
 * Each .yml / .yaml file should contain a single rule object.
 * Returns an array of validated rules.
 */
function loadRulesFromDir(dir: string): YamlRule[] {
  if (!existsSync(dir)) return [];

  const rules: YamlRule[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (ext !== '.yml' && ext !== '.yaml') continue;

    const filePath = join(dir, entry);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      console.warn(`[ast-rules] Could not read rule file: ${filePath}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(content);
    } catch (err) {
      console.warn(
        `[ast-rules] Failed to parse YAML in ${filePath}:`,
        err instanceof Error ? err.message : String(err)
      );
      continue;
    }

    // Support both single-rule files and arrays of rules
    const items = Array.isArray(parsed) ? parsed : [parsed];

    for (const item of items) {
      const error = validateRule(item, filePath);
      if (error) {
        console.warn(`[ast-rules] Skipping invalid rule: ${error}`);
        continue;
      }
      rules.push(item as YamlRule);
    }
  }

  return rules;
}

/**
 * Load rules from the standard rules directory and its subdirectories (one level).
 */
function loadAllRules(repoPath: string): YamlRule[] {
  const rulesDir = join(repoPath, '.vibecheck', 'rules');
  if (!existsSync(rulesDir)) return [];

  // Load rules from the root rules dir
  const rules = loadRulesFromDir(rulesDir);

  // Load rules from immediate subdirectories (e.g., examples/)
  let subdirs: string[];
  try {
    subdirs = readdirSync(rulesDir);
  } catch {
    return rules;
  }

  for (const entry of subdirs) {
    const fullPath = join(rulesDir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        rules.push(...loadRulesFromDir(fullPath));
      }
    } catch {
      // skip
    }
  }

  return rules;
}

/** Severity deductions for scoring */
const severityDeductions: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 5,
  low: 2,
  info: 0,
};

const runner: ModuleRunner = {
  async canRun(repoPath: string): Promise<boolean> {
    // Module can run if the .vibecheck/rules directory exists and has YAML files
    const rulesDir = join(repoPath, '.vibecheck', 'rules');
    if (!existsSync(rulesDir)) return false;

    const rules = loadAllRules(repoPath);
    return rules.length > 0;
  },

  async run(repoPath: string, opts: RunOptions): Promise<ModuleResult> {
    opts.onProgress?.(5, 'Loading custom ast-grep rules...');

    const rules = loadAllRules(repoPath);
    if (rules.length === 0) {
      return {
        score: 100,
        confidence: 1.0,
        findings: [],
        metrics: { total: 0, rulesLoaded: 0 },
        summary: 'No custom ast-grep rules found.',
      };
    }

    opts.onProgress?.(10, `Loaded ${rules.length} custom rules.`);

    const astGrep = tryLoadAstGrep();
    if (!astGrep) {
      console.warn('[ast-rules] @ast-grep/napi not available, skipping scan.');
      return {
        score: 100,
        confidence: 0,
        findings: [],
        metrics: { total: 0, rulesLoaded: rules.length },
        summary:
          '@ast-grep/napi is not available. Install it to enable custom rule scanning.',
      };
    }

    const allFindings: Finding[] = [];

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];

      if (opts.signal?.aborted) break;

      const pct = Math.round(10 + (85 * (i + 1)) / rules.length);
      opts.onProgress?.(pct, `Scanning rule: ${rule.name}`);

      try {
        const matches = scanFiles(repoPath, rule, astGrep);

        for (const match of matches) {
          const findingData: Omit<Finding, 'id' | 'fingerprint'> = {
            severity: rule.severity,
            filePath: match.relativePath,
            line: match.line,
            message: `[${rule.id}] ${rule.message}`,
            category: rule.category,
            suggestion: rule.suggestion,
          };

          allFindings.push({
            ...findingData,
            id: nanoid(),
            fingerprint: generateFingerprint('ast-rules', findingData),
          });
        }
      } catch (err) {
        console.warn(
          `[ast-rules] Rule "${rule.id}" failed:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Deduplicate by fingerprint
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
      rulesLoaded: rules.length,
    };

    opts.onProgress?.(100, 'Custom ast-grep rule scan complete.');

    const parts: string[] = [];
    if (metrics.critical > 0) parts.push(`${metrics.critical} critical`);
    if (metrics.high > 0) parts.push(`${metrics.high} high`);
    if (metrics.medium > 0) parts.push(`${metrics.medium} medium`);
    if (metrics.low > 0) parts.push(`${metrics.low} low`);

    const summary =
      deduped.length === 0
        ? `No issues found (${rules.length} custom rules checked).`
        : `Found ${deduped.length} issues: ${parts.join(', ')}. (${rules.length} custom rules checked)`;

    return {
      score,
      confidence: 0.8,
      findings: deduped,
      metrics,
      summary,
    };
  },
};

registerModule(
  {
    id: 'ast-rules',
    name: 'Custom AST Rules',
    description:
      'Scans source code using custom structural patterns defined as YAML rules in .vibecheck/rules/. Uses ast-grep for fast, zero-AI-cost pattern matching against architectural conventions, code quality checks, and security patterns.',
    category: 'static',
    defaultEnabled: true,
  },
  runner
);
