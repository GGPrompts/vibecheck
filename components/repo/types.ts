export interface RepoData {
  id: string;
  name: string;
  path: string;
  mode?: 'maintaining' | 'evaluating';
  latestScan: {
    id: string;
    status: string;
    overallScore: number | null;
    createdAt: string;
  } | null;
}

export interface ScanFinding {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
  moduleId?: string;
}

export interface ScanModule {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  metrics: Record<string, number> | null;
  findings: ScanFinding[];
}

export interface ScanDetail {
  scan: {
    id: string;
    repoId: string;
    status: string;
    overallScore: number | null;
    durationMs: number | null;
    createdAt: string;
  };
  modules: ScanModule[];
}

export type EvaluationVerdict = 'low-risk' | 'moderate-risk' | 'high-risk' | 'avoid';

export interface EvaluationResult {
  adoptionRisk: number;
  verdict: EvaluationVerdict;
  reasons: string[];
}

interface AuditFinding {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
}

export interface AuditModule {
  id: string;
  moduleId: string;
  summary: string;
  findings: AuditFinding[];
  tokensUsed: number | null;
  durationMs: number | null;
}

export interface AuditDetail {
  audit: {
    id: string;
    repoId: string;
    provider: string;
    model: string | null;
    status: string;
    durationMs: number | null;
    createdAt: string;
  };
  modules: AuditModule[];
}

export type AuditProvider = 'claude-api' | 'claude-cli' | 'codex';

export const PROVIDER_LABELS: Record<AuditProvider, string> = {
  'claude-api': 'Claude API',
  'claude-cli': 'Claude CLI',
  codex: 'Codex',
};

export interface HotspotDataPoint {
  fileName: string;
  churn: number;
  complexity: number;
  quadrant: 'toxic' | 'frozen' | 'quick-win' | 'healthy';
}
