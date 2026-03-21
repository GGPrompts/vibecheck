export interface ModelOverrides {
  global?: string;
  modules?: Record<string, string>;
}

export interface Settings {
  hasApiKey: boolean;
  enabledModules: string[] | null;
  aiTokenBudget: number;
  aiProvider: "api" | "cli" | "auto" | "codex";
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

export type ModuleGroup = 'static' | 'ai' | 'runtime' | 'go-native' | 'rust-native';

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  /** UI grouping derived from module id and category */
  group: ModuleGroup;
}

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  static: 'Static Analysis',
  ai: 'AI-Powered',
  runtime: 'Runtime',
  'go-native': 'Go Native',
  'rust-native': 'Rust Native',
};

export const MODULE_GROUP_ORDER: ModuleGroup[] = [
  'static',
  'ai',
  'runtime',
  'go-native',
  'rust-native',
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
