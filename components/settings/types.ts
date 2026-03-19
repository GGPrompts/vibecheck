export interface ModelOverrides {
  global?: string;
  modules?: Record<string, string>;
}

export interface Settings {
  hasApiKey: boolean;
  enabledModules: string[] | null;
  aiTokenBudget: number;
  aiProvider: "api" | "cli" | "auto";
  modelOverrides?: ModelOverrides | null;
  profile?: string;
  tier?: string;
}

export interface Repo {
  id: string;
  name: string;
  path: string;
  latestScan: {
    id: string;
    status: string;
    overallScore: number | null;
    createdAt: string;
  } | null;
}

export interface AuditPromptEntry {
  moduleId: string;
  name: string;
  prompt: string;
  isCustom: boolean;
}

export const MODULE_LIST = [
  {
    id: "security",
    name: "Security",
    description: "Scans for common security vulnerabilities and exposed secrets.",
  },
  {
    id: "dependencies",
    name: "Dependencies",
    description: "Checks for outdated, deprecated, or vulnerable packages.",
  },
  {
    id: "complexity",
    name: "Complexity",
    description: "Analyzes code complexity metrics and identifies overly complex functions.",
  },
  {
    id: "git-health",
    name: "Git Health",
    description: "Evaluates commit patterns, branch hygiene, and collaboration metrics.",
  },
];

export const AI_MODULE_LIST = [
  { id: "naming-quality", name: "Naming Quality" },
  { id: "doc-staleness", name: "Doc Staleness" },
  { id: "arch-smells", name: "Architecture Smells" },
  { id: "test-quality", name: "Test Quality" },
];

export const TIER_OPTIONS = [
  { value: "haiku", label: "Haiku", price: "$0.25 / $1.25" },
  { value: "sonnet", label: "Sonnet", price: "$3.00 / $15.00" },
  { value: "opus", label: "Opus", price: "$15.00 / $75.00" },
] as const;

export function formatTokenBudget(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K tokens`;
  }
  return `${value} tokens`;
}
