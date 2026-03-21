// ---------------------------------------------------------------------------
// Shared types for comparison page
// ---------------------------------------------------------------------------

export interface ComparisonScan {
  id: string;
  status: string;
  overallScore: number | null;
  createdAt: string;
}

export interface ComparisonAudit {
  id: string;
  provider: string;
  model: string | null;
  status: string;
  createdAt: string;
}

export interface ModuleComparison {
  moduleId: string;
  hasScan: boolean;
  hasAudit: boolean;
  scanScore: number | null;
  scanConfidence: number | null;
  scanSummary: string | null;
  scanFindingCount: number;
  auditSummary: string | null;
  auditFindingCount: number;
}

export interface BothFlaggedItem {
  similarity: number;
  scan: {
    severity: string;
    filePath: string | null;
    line: number | null;
    message: string;
    category: string;
    moduleId: string;
  };
  audit: {
    severity: string;
    file: string;
    line?: number;
    message: string;
    category: string;
    moduleId: string;
  };
}

export interface ScanOnlyItem {
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  moduleId: string;
}

export interface AuditOnlyItem {
  severity: string;
  file: string;
  line?: number;
  message: string;
  category: string;
  moduleId: string;
}

export interface ComparisonData {
  scan: ComparisonScan | null;
  audit: ComparisonAudit | null;
  moduleComparisons: ModuleComparison[];
  findingDiff: {
    bothFlagged: BothFlaggedItem[];
    scanOnly: ScanOnlyItem[];
    auditOnly: AuditOnlyItem[];
  };
  summary: {
    bothFlaggedCount: number;
    scanOnlyCount: number;
    auditOnlyCount: number;
  };
}
