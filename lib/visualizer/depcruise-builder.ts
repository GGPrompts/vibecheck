import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import Graph from 'graphology';
import { countLines } from './source-walker';
import type { NodeAttrs, EdgeAttrs, DepCruiseOutput } from './graph-types';

// ---------------------------------------------------------------------------
// Try running depcruise
// ---------------------------------------------------------------------------

export function tryDepcruise(repoPath: string, sourceDirs: string[]): DepCruiseOutput | null {
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

export function buildFromDepcruise(
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
