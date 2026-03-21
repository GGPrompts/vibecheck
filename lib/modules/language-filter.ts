import type { RepoLanguages, Language } from '@/lib/metadata/language-detector';

// ── Language → module mapping ───────────────────────────────────────────

const JS_TS_MODULES = new Set([
  'security', 'dependencies', 'complexity', 'dead-code',
  'circular-deps', 'test-coverage', 'ast-rules', 'compliance', 'api-health',
]);

const GO_MODULES = new Set([
  'go-security', 'go-dependencies', 'go-complexity',
  'go-dead-code', 'go-test-coverage',
]);

const RUST_MODULES = new Set([
  'rust-security', 'rust-dependencies', 'rust-complexity',
  'rust-dead-code', 'rust-test-coverage',
]);

/** Modules that run regardless of detected language. */
const UNIVERSAL_MODULES = new Set([
  'git-health', 'naming-quality', 'doc-staleness',
  'arch-smells', 'test-quality',
]);

/**
 * Given detected repo languages, return the set of module IDs that should
 * be allowed to run. Universal modules are always included.
 */
export function getAllowedModulesForLanguages(languages: RepoLanguages): Set<string> {
  const allowed = new Set(UNIVERSAL_MODULES);
  const { primary, all } = languages;

  const hasLang = (lang: Language) =>
    primary === lang || all.includes(lang);

  const isJsTs = hasLang('typescript') || hasLang('javascript');
  const isGo = hasLang('go');
  const isRust = hasLang('rust');

  if (isJsTs) for (const m of JS_TS_MODULES) allowed.add(m);
  if (isGo) for (const m of GO_MODULES) allowed.add(m);
  if (isRust) for (const m of RUST_MODULES) allowed.add(m);

  // If nothing specific was detected, allow everything (safe fallback)
  if (!isJsTs && !isGo && !isRust) {
    for (const m of JS_TS_MODULES) allowed.add(m);
    for (const m of GO_MODULES) allowed.add(m);
    for (const m of RUST_MODULES) allowed.add(m);
  }

  return allowed;
}
