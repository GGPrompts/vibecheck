import type { RepoTraits } from '@/lib/config/auto-detect';
import type { ProjectProfile } from '@/lib/config/profiles';

export type ModuleCategory = 'static' | 'ai';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ModuleRunState =
  | 'completed'
  | 'not_applicable'
  | 'insufficient_evidence'
  | 'skipped'
  | 'unavailable';

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  defaultEnabled: boolean;
}

export interface AutoDetectInfo {
  /** Knip entry points derived from package.json and directory patterns. */
  knipEntryPoints: string[];
  /** Knip ignore patterns for directories that should not be flagged. */
  knipIgnorePatterns: string[];
  /** File roles that should suppress "unused file" dead-code warnings. */
  deadCodeExemptRoles: Set<string>;
  /** Repo archetype inferred from repo shape heuristics. */
  detectedArchetype?: ProjectProfile | null;
  /** Repo traits used by modules to calibrate applicability. */
  repoTraits?: RepoTraits;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (pct: number, msg: string) => void;
  fileRoles?: Map<string, string[]>;
  /** Auto-detected repo info for modules that need it (e.g. dead-code). */
  autoDetect?: AutoDetectInfo;
  /**
   * Per-project command overrides from .vibecheckrc.
   * If a key maps to a string, that command replaces the default.
   * If a key maps to null, the module should return not_applicable.
   * If a key is absent, fall back to auto-detection.
   */
  commands?: Record<string, string | null>;
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
  /** Execution/applicability state for downstream consumers. */
  state?: ModuleRunState;
  /** Human-readable reason for non-completed states. */
  stateReason?: string;
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
