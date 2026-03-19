/**
 * Risk-language mapping for enterprise compliance reporting.
 *
 * Translates technical severity levels into business-friendly risk language
 * that executives and compliance teams can act on.
 */

export interface BusinessRisk {
  label: string;
  color: string;
  urgency: string;
}

const DEFAULT_RISK_MAP: Record<string, BusinessRisk> = {
  critical: {
    label: 'Critical Risk — Immediate action required',
    color: '#dc2626',
    urgency: 'Immediate',
  },
  high: {
    label: 'Significant Risk — Address within current sprint',
    color: '#ea580c',
    urgency: 'High',
  },
  medium: {
    label: 'Moderate Risk — Plan for remediation',
    color: '#d97706',
    urgency: 'Medium',
  },
  low: {
    label: 'Low Risk — Track and monitor',
    color: '#2563eb',
    urgency: 'Low',
  },
  info: {
    label: 'Informational — No action required',
    color: '#6b7280',
    urgency: 'None',
  },
};

let overrideMap: Partial<Record<string, BusinessRisk>> = {};

/**
 * Map a technical severity string to business risk language.
 *
 * Falls back to custom overrides first, then the built-in defaults,
 * then a generic "Unknown" entry for unrecognised severities.
 */
export function mapToBusinessRisk(severity: string): BusinessRisk {
  const key = severity.toLowerCase();

  if (overrideMap[key]) {
    return overrideMap[key];
  }

  if (DEFAULT_RISK_MAP[key]) {
    return DEFAULT_RISK_MAP[key];
  }

  return {
    label: `Unknown Risk Level (${severity})`,
    color: '#6b7280',
    urgency: 'Unknown',
  };
}

/**
 * Set custom overrides for risk mapping.
 * Merged on top of defaults — only overridden keys are replaced.
 */
export function setRiskOverrides(overrides: Partial<Record<string, BusinessRisk>>): void {
  overrideMap = { ...overrides };
}

/**
 * Reset overrides back to defaults.
 */
export function clearRiskOverrides(): void {
  overrideMap = {};
}

/**
 * Get all severity levels in priority order (most severe first).
 */
export function getSeverityLevels(): string[] {
  return ['critical', 'high', 'medium', 'low', 'info'];
}
