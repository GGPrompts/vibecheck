export type ModuleCategory = 'static' | 'ai';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

type FindingStatus = 'new' | 'recurring' | 'fixed' | 'regressed';

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  defaultEnabled: boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (pct: number, msg: string) => void;
  fileRoles?: Map<string, string[]>;
}

export interface Finding {
  id: string;
  fingerprint: string;
  severity: Severity;
  filePath: string;
  line?: number;
  message: string;
  category: string;
  suggestion?: string;
}

export interface ModuleResult {
  /** Score from 0 to 100 */
  score: number;
  /** Confidence from 0.0 to 1.0 */
  confidence: number;
  findings: Finding[];
  metrics: Record<string, number>;
  summary: string;
}

export interface ModuleRunner {
  canRun(repoPath: string): Promise<boolean>;
  run(repoPath: string, opts: RunOptions): Promise<ModuleResult>;
}

export interface RegisteredModule {
  definition: ModuleDefinition;
  runner: ModuleRunner;
}
