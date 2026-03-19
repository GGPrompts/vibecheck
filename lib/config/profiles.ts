/**
 * Project profile definitions.
 *
 * Profiles let users declare their project type so scoring adjusts
 * automatically — a solo dev shouldn't be penalized for bus factor,
 * a prototype shouldn't get strict complexity checks, etc.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectProfile = 'solo' | 'team' | 'library' | 'prototype' | 'enterprise';

export interface ProfileConfig {
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
      'git-health': false, // bus-factor findings are irrelevant for solo devs
    },
    thresholds: {
      'complexity-loc': 800,
      'complexity-cyclomatic': 20,
      'dead-code': 60, // relax unused-export scoring
    },
    description: 'Solo developer — disables bus-factor, relaxes complexity and dead-code thresholds',
  },

  team: {
    modules: {},
    thresholds: {},
    description: 'Team project — all defaults (current behavior)',
  },

  library: {
    modules: {
      'git-health': false, // bus-factor less relevant for libraries
    },
    thresholds: {
      'dead-code': 90, // strict unused exports — libraries should have clean public APIs
      complexity: 90, // strict complexity
    },
    description: 'Published library — strict unused exports and complexity, no bus-factor',
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
    description: 'Prototype / spike — disables dead-code and git-health, heavily relaxes complexity; only security stays normal',
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
