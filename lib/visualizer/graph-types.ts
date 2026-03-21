// ---------------------------------------------------------------------------
// Shared types for graph-builder modules
// ---------------------------------------------------------------------------

export interface NodeAttrs {
  filePath: string;
  loc: number;
  fanIn: number;
  fanOut: number;
  isDynamic: boolean;
  isIsland: boolean;
  isEntryPoint: boolean;
  circularDeps: string[][];
}

export interface EdgeAttrs {
  isDynamic: boolean;
  symbols: string[];
}

export interface DepCruiseModule {
  source: string;
  dependencies: Array<{
    resolved: string;
    module: string;
    dynamic?: boolean;
    circular?: boolean;
    cycle?: string[];
    dependencyTypes?: string[];
  }>;
}

export interface DepCruiseOutput {
  modules?: DepCruiseModule[];
  summary?: {
    violations?: Array<{
      type: string;
      from: string;
      to: string;
      cycle?: string[];
      rule?: { name: string; severity: string };
    }>;
    error: number;
    warn: number;
    info: number;
    totalCruised: number;
  };
}
