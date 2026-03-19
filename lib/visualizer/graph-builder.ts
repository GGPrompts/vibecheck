import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, extname } from 'path';
import Graph from 'graphology';
import type { SerializedGraph } from 'graphology-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NodeAttrs {
  filePath: string;
  loc: number;
  fanIn: number;
  fanOut: number;
  isDynamic: boolean;
  isIsland: boolean;
  isEntryPoint: boolean;
  circularDeps: string[][];
}

interface EdgeAttrs {
  isDynamic: boolean;
  symbols: string[];
}

interface DepCruiseModule {
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

interface DepCruiseOutput {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs',
]);

/** Count lines in a file. Returns 0 if unreadable. */
function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/** Detect source directories that exist in the repo. */
function detectSourceDirs(repoPath: string): string[] {
  const candidates = ['src', 'lib', 'app', 'source', 'packages'];
  const found: string[] = [];

  for (const dir of candidates) {
    if (existsSync(join(repoPath, dir))) {
      found.push(dir);
    }
  }

  if (found.length === 0) {
    try {
      const entries = readdirSync(repoPath);
      const hasSourceFiles = entries.some((e) =>
        SOURCE_EXTENSIONS.has(extname(e)),
      );
      if (hasSourceFiles) {
        found.push('.');
      }
    } catch {
      // ignore
    }
  }

  return found;
}

/**
 * Walk a directory tree and collect all source files, returning paths
 * relative to repoPath.
 */
function walkSourceFiles(repoPath: string, dirs: string[]): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === 'dist' || entry === 'build') {
        continue;
      }
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
          files.push(relative(repoPath, full));
        }
      } catch {
        // skip unreadable
      }
    }
  }

  for (const d of dirs) {
    walk(resolve(repoPath, d));
  }

  return files;
}

// Regex patterns for matching import/require statements
const IMPORT_PATTERNS = [
  // import ... from '...'
  /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  // import '...'  (side-effect imports)
  /import\s+['"]([^'"]+)['"]/g,
  // require('...')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // dynamic import('...')
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // export ... from '...'
  /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
];

const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Regex to extract named symbols from imports: import { Foo, Bar as Baz } from '...'
const NAMED_IMPORT_PATTERN =
  /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

interface ParsedImport {
  specifier: string;
  isDynamic: boolean;
  symbols: string[];
}

/** Parse imports from a source file. */
function parseImports(filePath: string): ParsedImport[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const imports = new Map<string, ParsedImport>();

  // Collect dynamic import specifiers first so we can mark them
  const dynamicSpecifiers = new Set<string>();
  let dm: RegExpExecArray | null;
  const dynRe = new RegExp(DYNAMIC_IMPORT_PATTERN.source, 'g');
  while ((dm = dynRe.exec(content)) !== null) {
    dynamicSpecifiers.add(dm[1]);
  }

  // Collect named symbols
  const symbolMap = new Map<string, string[]>();
  const namedRe = new RegExp(NAMED_IMPORT_PATTERN.source, 'g');
  let nm: RegExpExecArray | null;
  while ((nm = namedRe.exec(content)) !== null) {
    const symbols = nm[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    const spec = nm[2];
    symbolMap.set(spec, [...(symbolMap.get(spec) ?? []), ...symbols]);
  }

  for (const pattern of IMPORT_PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const specifier = match[1];
      // Skip non-relative imports (packages)
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        continue;
      }
      if (!imports.has(specifier)) {
        imports.set(specifier, {
          specifier,
          isDynamic: dynamicSpecifiers.has(specifier),
          symbols: symbolMap.get(specifier) ?? [],
        });
      }
    }
  }

  return Array.from(imports.values());
}

/** Resolve an import specifier to a file path relative to repoPath. */
function resolveImport(
  importerRelative: string,
  specifier: string,
  repoPath: string,
  knownFiles: Set<string>,
): string | null {
  let basePath: string;

  if (specifier.startsWith('@/')) {
    // Alias — resolve relative to repoPath
    basePath = specifier.slice(2);
  } else {
    // Relative import
    const importerDir = join(repoPath, importerRelative, '..');
    basePath = relative(repoPath, resolve(importerDir, specifier));
  }

  // Normalise separators for Windows compat
  basePath = basePath.replace(/\\/g, '/');

  // Try exact match first
  if (knownFiles.has(basePath)) return basePath;

  // Try adding extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];
  for (const ext of extensions) {
    if (knownFiles.has(basePath + ext)) return basePath + ext;
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = basePath + '/index' + ext;
    if (knownFiles.has(indexPath)) return indexPath;
  }

  return null;
}

// ---------------------------------------------------------------------------
// depcruise-based builder (preferred when available)
// ---------------------------------------------------------------------------

function tryDepcruise(repoPath: string, sourceDirs: string[]): DepCruiseOutput | null {
  const dirsArg = sourceDirs.join(' ');
  const tsConfigArg = existsSync(join(repoPath, 'tsconfig.json'))
    ? ' --ts-config tsconfig.json'
    : '';
  const cmd = `npx depcruise --output-type json --no-config --do-not-follow "node_modules"${tsConfigArg} ${dirsArg}`;

  let stdout = '';
  try {
    stdout = execSync(cmd, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof (error as { stdout: unknown }).stdout === 'string'
    ) {
      stdout = (error as { stdout: string }).stdout;
    } else {
      return null;
    }
  }

  if (!stdout.trim()) return null;

  try {
    const data = JSON.parse(stdout) as DepCruiseOutput;
    if (data.modules && data.modules.length > 0) return data;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build graph from depcruise output
// ---------------------------------------------------------------------------

function buildFromDepcruise(
  repoPath: string,
  data: DepCruiseOutput,
): Graph<NodeAttrs, EdgeAttrs> {
  const graph = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });

  const modules = data.modules ?? [];

  // Collect circular dep info
  const circularDeps = new Map<string, string[][]>();
  if (data.summary?.violations) {
    for (const v of data.summary.violations) {
      if (v.cycle && v.cycle.length > 0) {
        const existing = circularDeps.get(v.from) ?? [];
        existing.push(v.cycle);
        circularDeps.set(v.from, existing);
      }
    }
  }

  // Add nodes
  for (const mod of modules) {
    const filePath = mod.source;
    const fullPath = join(repoPath, filePath);
    const isEntry = filePath.startsWith('app/') || filePath.startsWith('pages/');

    graph.addNode(filePath, {
      filePath,
      loc: countLines(fullPath),
      fanIn: 0,
      fanOut: mod.dependencies.length,
      isDynamic: false,
      isIsland: false,
      isEntryPoint: isEntry,
      circularDeps: circularDeps.get(filePath) ?? [],
    });
  }

  // Add edges
  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      const target = dep.resolved;
      if (!target || !graph.hasNode(target)) continue;
      if (graph.hasEdge(mod.source, target)) continue;

      graph.addEdge(mod.source, target, {
        isDynamic: !!dep.dynamic,
        symbols: [],
      });
    }
  }

  // Calculate fan-in
  graph.forEachEdge((_edge, _attrs, _source, target) => {
    const current = graph.getNodeAttribute(target, 'fanIn');
    graph.setNodeAttribute(target, 'fanIn', current + 1);
  });

  // Mark islands: fanIn === 0 and not an entry point
  graph.forEachNode((node, attrs) => {
    if (attrs.fanIn === 0 && !attrs.isEntryPoint) {
      graph.setNodeAttribute(node, 'isIsland', true);
    }
  });

  return graph;
}

// ---------------------------------------------------------------------------
// Build graph from regex-based import parsing (fallback)
// ---------------------------------------------------------------------------

function buildFromRegex(
  repoPath: string,
  sourceDirs: string[],
): Graph<NodeAttrs, EdgeAttrs> {
  const graph = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });

  const files = walkSourceFiles(repoPath, sourceDirs);
  const fileSet = new Set(files);

  // Add all nodes first
  for (const file of files) {
    const fullPath = join(repoPath, file);
    const isEntry = file.startsWith('app/') || file.startsWith('pages/');

    graph.addNode(file, {
      filePath: file,
      loc: countLines(fullPath),
      fanIn: 0,
      fanOut: 0,
      isDynamic: false,
      isIsland: false,
      isEntryPoint: isEntry,
      circularDeps: [],
    });
  }

  // Parse imports and add edges
  for (const file of files) {
    const fullPath = join(repoPath, file);
    const imports = parseImports(fullPath);
    let outCount = 0;

    for (const imp of imports) {
      const resolved = resolveImport(file, imp.specifier, repoPath, fileSet);
      if (!resolved || !graph.hasNode(resolved)) continue;
      if (file === resolved) continue; // self-import
      if (graph.hasEdge(file, resolved)) continue;

      graph.addEdge(file, resolved, {
        isDynamic: imp.isDynamic,
        symbols: imp.symbols,
      });
      outCount++;
    }

    graph.setNodeAttribute(file, 'fanOut', outCount);
  }

  // Calculate fan-in
  graph.forEachEdge((_edge, _attrs, _source, target) => {
    const current = graph.getNodeAttribute(target, 'fanIn');
    graph.setNodeAttribute(target, 'fanIn', current + 1);
  });

  // Detect circular dependencies (simple DFS cycle detection)
  const circularDeps = detectCircularDeps(graph);
  for (const [node, cycles] of circularDeps) {
    if (graph.hasNode(node)) {
      graph.setNodeAttribute(node, 'circularDeps', cycles);
    }
  }

  // Mark islands: fanIn === 0 and not an entry point
  graph.forEachNode((node, attrs) => {
    if (attrs.fanIn === 0 && !attrs.isEntryPoint) {
      graph.setNodeAttribute(node, 'isIsland', true);
    }
  });

  return graph;
}

/** Simple DFS-based circular dependency detection. */
function detectCircularDeps(
  graph: Graph<NodeAttrs, EdgeAttrs>,
): Map<string, string[][]> {
  const result = new Map<string, string[][]>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const seenCycles = new Set<string>();

  function dfs(node: string, path: string[]) {
    if (inStack.has(node)) {
      // Found a cycle — extract it
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = path.slice(cycleStart);
        // Normalize: rotate so smallest element is first
        const normalized = normalizeCycle(cycle);
        const key = normalized.join(' -> ');
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          // Attach cycle to every node in it
          for (const n of cycle) {
            const existing = result.get(n) ?? [];
            existing.push(normalized);
            result.set(n, existing);
          }
        }
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const neighbors = graph.outNeighbors(node);
    for (const neighbor of neighbors) {
      dfs(neighbor, [...path, node]);
    }

    inStack.delete(node);
  }

  graph.forEachNode((node) => {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  });

  return result;
}

function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) return cycle;
  let minIdx = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) minIdx = i;
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an import graph for a repository.
 *
 * Tries dependency-cruiser first. If unavailable or fails, falls back to
 * regex-based import parsing.
 *
 * Returns a serialized graphology graph suitable for JSON transport.
 */
export function buildImportGraph(repoPath: string): SerializedGraph<NodeAttrs, EdgeAttrs> {
  const absPath = resolve(repoPath);
  const sourceDirs = detectSourceDirs(absPath);

  if (sourceDirs.length === 0) {
    // Return empty graph
    const empty = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });
    return empty.export();
  }

  // Try depcruise first
  const depcruiseData = tryDepcruise(absPath, sourceDirs);
  let graph: Graph<NodeAttrs, EdgeAttrs>;

  if (depcruiseData) {
    graph = buildFromDepcruise(absPath, depcruiseData);
  } else {
    graph = buildFromRegex(absPath, sourceDirs);
  }

  return graph.export();
}
