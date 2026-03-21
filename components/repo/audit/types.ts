export interface Scan {
  id: string;
  repoId: string | null;
  repoName: string | null;
  status: string;
  overallScore: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface Finding {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
}

export interface ModuleResult {
  id: string;
  moduleId: string;
  score: number;
  confidence: number;
  summary: string | null;
  findings: Finding[];
}

export interface ScanDetail {
  scan: {
    id: string;
    repoId: string | null;
    status: string;
    overallScore: number | null;
    durationMs: number | null;
    createdAt: string;
  };
  modules: ModuleResult[];
}

export interface AuditEntry {
  scan: Scan;
  detail: ScanDetail | null;
  delta: number | null;
  moduleDiffs: Array<{
    moduleId: string;
    current: number;
    previous: number;
    diff: number;
  }>;
}
