/**
 * Project profile definitions.
 *
 * Profiles let users declare their project type so scoring adjusts
 * automatically — a prototype shouldn't get strict complexity checks,
 * enterprise projects need strict everything, etc.
 * Note: bus-factor is info-only (0% weight) so it no longer penalizes
 * solo devs or single-author repos.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectProfile = 'solo' | 'team' | 'library' | 'prototype' | 'enterprise';

interface ProfileConfig {
  /** Enable/disable modules by id. `false` disables, `true` force-enables. */
  modules: Record<string, boolean>;
  /** Override scoring thresholds per module. */
  thresholds: Record<string, number>;
  /** Human-readable description of the profile. */
  description: string;
}

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

export const PROFILES: Record<ProjectProfile, ProfileConfig> = {
  solo: {
    modules: {
      // git-health is now safe for solo devs: bus-factor is info-only (0% weight)
    },
    thresholds: {
      'complexity-loc': 800,
      'complexity-cyclomatic': 20,
      'dead-code': 60, // relax unused-export scoring
      'telemetry-observability': 80, // solo devs need MORE observability — no team to debug for you
    },
    description: 'Solo developer — relaxes complexity and dead-code thresholds, strict observability',
  },

  team: {
    modules: {},
    thresholds: {},
    description: 'Team project — all defaults (current behavior)',
  },

  library: {
    modules: {
      // git-health is now safe for libraries: bus-factor is info-only (0% weight)
    },
    thresholds: {
      'dead-code': 90, // strict unused exports — libraries should have clean public APIs
      complexity: 90, // strict complexity
    },
    description: 'Published library — strict unused exports and complexity',
  },

  prototype: {
    modules: {
      'dead-code': false,
      'git-health': false,
    },
    thresholds: {
      'complexity-loc': 1500,
      'complexity-cyclomatic': 30,
    },
    description: 'Prototype / spike — disables dead-code and git-health, heavily relaxes complexity; security and observability stay normal',
  },

  enterprise: {
    modules: {
      'compliance-hipaa': true, // force-enable compliance
    },
    thresholds: {
      complexity: 90,
      'dead-code': 90,
      security: 95,
      'git-health': 85,
      dependencies: 90,
      'telemetry-observability': 90,
    },
    description: 'Enterprise — strict everything, enables compliance modules, low thresholds',
  },
};

// ---------------------------------------------------------------------------
// Accessor
// ---------------------------------------------------------------------------

export function getProfileConfig(profile: ProjectProfile): ProfileConfig {
  return PROFILES[profile];
}
