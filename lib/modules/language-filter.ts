import type { RepoLanguages, Language } from '@/lib/metadata/language-detector';
import {
  getProfileConfig,
  type ProjectProfile,
} from '@/lib/config/profiles';
import type { RepoTraits } from '@/lib/config/auto-detect';

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
function hasServiceShape(archetype: ProjectProfile | null, traits: RepoTraits): boolean {
  return Boolean(
    traits.hasApiRoutes
    || traits.hasLongRunningServer
    || traits.hasDeployableService
    || archetype === 'web-app'
    || archetype === 'api-service',
  );
}

function hasLibraryShape(archetype: ProjectProfile | null, traits: RepoTraits): boolean {
  return Boolean(
    traits.hasPackageLibraryShape
    || archetype === 'library'
    || archetype === 'cli',
  );
}

function hasBuildableShape(archetype: ProjectProfile | null, traits: RepoTraits): boolean {
  return Boolean(
    hasServiceShape(archetype, traits)
    || hasLibraryShape(archetype, traits)
    || traits.hasFrontendBundle
    || archetype === 'agent-tooling',
  );
}

function hasComplianceShape(archetype: ProjectProfile | null, traits: RepoTraits): boolean {
  return Boolean(traits.hasComplianceSignals || archetype === 'compliance-sensitive');
}

function isModuleApplicable(
  moduleId: string,
  archetype: ProjectProfile | null,
  traits: RepoTraits,
): boolean {
  if (
    moduleId === 'build'
    || moduleId === 'lint'
    || moduleId === 'typecheck'
  ) {
    return hasBuildableShape(archetype, traits);
  }

  if (moduleId === 'test') {
    return traits.hasTestSuite || hasBuildableShape(archetype, traits);
  }

  if (moduleId === 'api-health') {
    return hasServiceShape(archetype, traits);
  }

  if (moduleId === 'telemetry-observability') {
    return hasServiceShape(archetype, traits) || traits.hasFrontendBundle;
  }

  if (moduleId === 'compliance-hipaa' || moduleId === 'secrets-scan') {
    return hasComplianceShape(archetype, traits);
  }

  if (moduleId === 'dead-code') {
    return hasLibraryShape(archetype, traits) || traits.hasFrontendBundle;
  }

  if (moduleId === 'test-coverage' || moduleId === 'test-quality') {
    return traits.hasTestSuite || archetype !== 'prototype';
  }

  if (moduleId === 'doc-accuracy' || moduleId === 'doc-staleness' || moduleId === 'context-conflicts') {
    return archetype === 'agent-tooling'
      || archetype === 'library'
      || archetype === 'compliance-sensitive'
      || traits.hasFrontendBundle;
  }

  if (moduleId === 'git-health') {
    return archetype !== 'prototype' || traits.hasCliEntrypoint;
  }

  return true;
}

export function getAllowedModulesForLanguages(
  languages: RepoLanguages,
  archetype: ProjectProfile | null = null,
  traits: RepoTraits = {
    hasApiRoutes: false,
    hasFrontendBundle: false,
    hasPackageLibraryShape: false,
    hasTestSuite: false,
    hasLongRunningServer: false,
    hasDeployableService: false,
    hasCliEntrypoint: false,
    hasComplianceSignals: false,
    hasAgentToolingSignals: false,
  },
): Set<string> {
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

  if (archetype) {
    const profileConfig = getProfileConfig(archetype);
    for (const [moduleId, rule] of Object.entries(profileConfig.modules)) {
      if (rule.applicable === false) {
        allowed.delete(moduleId);
      }
    }
  }

  for (const moduleId of Array.from(allowed)) {
    if (!isModuleApplicable(moduleId, archetype, traits)) {
      allowed.delete(moduleId);
    }
  }

  return allowed;
}
