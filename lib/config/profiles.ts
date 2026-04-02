/**
 * Repo archetype definitions.
 *
 * Archetypes are the repo-shape layer that sits above language detection:
 * they tune which modules count and how heavily they influence the score.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectProfile =
  | 'web-app'
  | 'api-service'
  | 'library'
  | 'cli'
  | 'agent-tooling'
  | 'prototype'
  | 'compliance-sensitive';

export type LegacyProjectProfile = 'solo' | 'team' | 'enterprise';

export interface ModuleArchetypeRule {
  /** `false` marks the module as not applicable for the archetype. */
  applicable?: boolean;
  /** Weight multiplier applied when the archetype is active. */
  weight?: number;
}

export interface ProfileConfig {
  /** Per-module applicability and weight defaults. */
  modules: Record<string, ModuleArchetypeRule>;
  /** Override scoring thresholds per module. */
  thresholds: Record<string, number>;
  /** Human-readable description of the archetype. */
  description: string;
}

const LEGACY_PROFILE_ALIASES: Record<LegacyProjectProfile, ProjectProfile> = {
  solo: 'prototype',
  team: 'web-app',
  enterprise: 'compliance-sensitive',
};

const modules = (
  entries: Record<string, ModuleArchetypeRule>,
): Record<string, ModuleArchetypeRule> => entries;

// ---------------------------------------------------------------------------
// Archetype definitions
// ---------------------------------------------------------------------------

export const PROFILES: Record<ProjectProfile, ProfileConfig> = {
  'web-app': {
    modules: modules({
      'api-health': { weight: 1.4 },
      'telemetry-observability': { weight: 1.2 },
      'dead-code': { weight: 1.15 },
      complexity: { weight: 1.05 },
      'test-coverage': { weight: 1.1 },
      'test-quality': { weight: 1.05 },
      'type-safety': { weight: 1.05 },
      'config-quality': { weight: 1.05 },
      'arch-smells': { weight: 1.1 },
      'doc-staleness': { weight: 0.85 },
      'context-conflicts': { weight: 0.9 },
      'error-handling': { weight: 1.0 },
    }),
    thresholds: {
      'complexity-loc': 650,
      'complexity-cyclomatic': 14,
      'dead-code': 70,
      'telemetry-observability': 85,
    },
    description: 'Web app — favors frontend, API-route, and observability checks.',
  },

  'api-service': {
    modules: modules({
      'api-health': { weight: 1.5 },
      security: { weight: 1.2 },
      dependencies: { weight: 1.15 },
      'test-coverage': { weight: 1.2 },
      'test-quality': { weight: 1.1 },
      'telemetry-observability': { weight: 1.3 },
      'config-quality': { weight: 1.1 },
      'secrets-scan': { weight: 1.2 },
      'type-safety': { weight: 1.05 },
      'arch-smells': { weight: 1.1 },
      build: { weight: 1.05 },
      lint: { weight: 1.05 },
      typecheck: { weight: 1.1 },
      test: { weight: 1.1 },
    }),
    thresholds: {
      'complexity-loc': 700,
      'complexity-cyclomatic': 15,
      security: 92,
      dependencies: 88,
    },
    description: 'API service — prioritizes runtime health, tests, and deployment hygiene.',
  },

  library: {
    modules: modules({
      'dead-code': { weight: 1.5 },
      dependencies: { weight: 1.25 },
      'type-safety': { weight: 1.2 },
      'circular-deps': { weight: 1.1 },
      'test-coverage': { weight: 1.15 },
      'test-quality': { weight: 1.05 },
      security: { weight: 1.1 },
      'config-quality': { weight: 1.0 },
      'doc-accuracy': { weight: 1.1 },
      'doc-staleness': { weight: 1.1 },
      'api-health': { applicable: false, weight: 0.4 },
      'telemetry-observability': { applicable: false, weight: 0.4 },
    }),
    thresholds: {
      'dead-code': 92,
      complexity: 88,
      dependencies: 88,
    },
    description: 'Library — strict public API hygiene, unused export cleanup, and type safety.',
  },

  cli: {
    modules: modules({
      'git-health': { weight: 1.3 },
      'config-quality': { weight: 0.9 },
      security: { weight: 1.05 },
      dependencies: { weight: 1.05 },
      'dead-code': { weight: 1.0 },
      'test-coverage': { weight: 1.05 },
      'type-safety': { weight: 1.1 },
      'doc-staleness': { weight: 1.0 },
      'api-health': { applicable: false, weight: 0.2 },
      'telemetry-observability': { applicable: false, weight: 0.2 },
    }),
    thresholds: {
      'complexity-loc': 750,
      'complexity-cyclomatic': 18,
      'git-health': 80,
    },
    description: 'CLI — favors packaging, configuration, and maintainability checks.',
  },

  'agent-tooling': {
    modules: modules({
      'context-conflicts': { weight: 1.4 },
      'doc-accuracy': { weight: 1.3 },
      'arch-smells': { weight: 1.2 },
      'error-handling': { weight: 1.2 },
      'test-quality': { weight: 1.1 },
      'doc-staleness': { weight: 1.1 },
      'config-quality': { weight: 1.1 },
      'naming-quality': { weight: 1.1 },
      'telemetry-observability': { weight: 1.0 },
      'api-health': { weight: 0.8 },
    }),
    thresholds: {
      'complexity-loc': 700,
      'complexity-cyclomatic': 16,
    },
    description: 'Agent tooling — prioritizes prompt clarity, instruction consistency, and runtime clarity.',
  },

  prototype: {
    modules: modules({
      'dead-code': { applicable: false, weight: 0.7 },
      'git-health': { weight: 0.75 },
      'config-quality': { weight: 0.8 },
      complexity: { weight: 0.8 },
      'test-quality': { weight: 0.9 },
      'doc-staleness': { weight: 0.8 },
      'api-health': { applicable: false, weight: 0.5 },
      'compliance-hipaa': { applicable: false, weight: 0.5 },
      'telemetry-observability': { applicable: false, weight: 0.6 },
    }),
    thresholds: {
      'complexity-loc': 1500,
      'complexity-cyclomatic': 30,
    },
    description: 'Prototype — keeps the score light while the repo is still moving quickly.',
  },

  'compliance-sensitive': {
    modules: modules({
      'compliance-hipaa': { weight: 1.6 },
      security: { weight: 1.3 },
      'secrets-scan': { weight: 1.4 },
      dependencies: { weight: 1.2 },
      'config-quality': { weight: 1.2 },
      'type-safety': { weight: 1.1 },
      'test-coverage': { weight: 1.15 },
      'telemetry-observability': { weight: 1.1 },
      'doc-staleness': { weight: 0.9 },
      'context-conflicts': { weight: 1.0 },
      'error-handling': { weight: 1.1 },
    }),
    thresholds: {
      'complexity-loc': 650,
      'complexity-cyclomatic': 14,
      security: 95,
      dependencies: 92,
      'compliance-hipaa': 95,
    },
    description: 'Compliance-sensitive — tightest controls for regulated or audit-heavy repos.',
  },
};

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function normalizeProjectProfile(
  profile: string | null | undefined,
): ProjectProfile | null {
  if (!profile) return null;
  if (profile in PROFILES) return profile as ProjectProfile;

  const legacy = LEGACY_PROFILE_ALIASES[profile as LegacyProjectProfile];
  return legacy ?? null;
}

export function getProfileConfig(profile: ProjectProfile): ProfileConfig {
  return PROFILES[profile];
}

export function getProfileModuleRule(
  profile: ProjectProfile,
  moduleId: string,
): ModuleArchetypeRule {
  return PROFILES[profile].modules[moduleId] ?? {};
}

export function getProfileModuleWeight(
  profile: ProjectProfile,
  moduleId: string,
): number {
  return getProfileModuleRule(profile, moduleId).weight ?? 1;
}

export function getProfileLabel(profile: ProjectProfile): string {
  switch (profile) {
    case 'web-app':
      return 'Web App';
    case 'api-service':
      return 'API Service';
    case 'library':
      return 'Library';
    case 'cli':
      return 'CLI';
    case 'agent-tooling':
      return 'Agent Tooling';
    case 'prototype':
      return 'Prototype';
    case 'compliance-sensitive':
      return 'Compliance Sensitive';
  }
}
