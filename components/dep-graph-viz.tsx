'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';

interface DepNode {
  id: string;
  inCycle: boolean;
}

interface DepLink {
  source: string;
  target: string;
  inCycle: boolean;
}

interface DepGraphVizProps {
  findings: Array<{
    filePath: string | null;
    message: string;
    severity: string;
    category: string;
  }>;
}

interface GraphData {
  nodes: DepNode[];
  links: DepLink[];
}

/**
 * Parse circular dependency findings into a graph with nodes and edges.
 * Cycle members are flagged so they can be highlighted in red.
 */
function buildGraphData(findings: DepGraphVizProps['findings']): GraphData {
  const nodeSet = new Set<string>();
  const links: DepLink[] = [];
  const cycleNodes = new Set<string>();

  for (const finding of findings) {
    if (!finding.filePath) continue;

    // Try to parse dependency chain from the message
    // Common patterns: "A -> B -> C -> A" or "A depends on B"
    const chainMatch = finding.message.match(
      /(?:cycle|circular)[^:]*:\s*([\w./\-@]+(?:\s*(?:->|→|=>)\s*[\w./\-@]+)+)/i
    );

    if (chainMatch) {
      const parts = chainMatch[1].split(/\s*(?:->|→|=>)\s*/);
      for (let i = 0; i < parts.length - 1; i++) {
        const source = parts[i].trim();
        const target = parts[i + 1].trim();
        nodeSet.add(source);
        nodeSet.add(target);
        cycleNodes.add(source);
        cycleNodes.add(target);
        links.push({ source, target, inCycle: true });
      }
    } else {
      // Fallback: use filePath as source, try to extract target from message
      const depMatch = finding.message.match(
        /(?:depends on|imports|requires)\s+['""]?([\w./\-@]+)['""]?/i
      );
      const source = finding.filePath;
      const target = depMatch ? depMatch[1] : null;

      if (source) {
        nodeSet.add(source);
        if (target) {
          nodeSet.add(target);
          const isCyclic = finding.severity === 'critical' || finding.severity === 'high'
            || finding.message.toLowerCase().includes('circular')
            || finding.message.toLowerCase().includes('cycle');
          if (isCyclic) {
            cycleNodes.add(source);
            cycleNodes.add(target);
          }
          links.push({ source, target, inCycle: isCyclic });
        }
      }
    }
  }

  // If we only got file paths without parseable deps, create a star from findings
  if (links.length === 0 && findings.length > 0) {
    const files = new Set<string>();
    for (const f of findings) {
      if (f.filePath) files.add(f.filePath);
    }
    const fileArr = Array.from(files);
    for (const file of fileArr) {
      nodeSet.add(file);
      cycleNodes.add(file);
    }
    // Create chain links between consecutive files to show a cycle
    for (let i = 0; i < fileArr.length; i++) {
      const next = fileArr[(i + 1) % fileArr.length];
      if (fileArr[i] !== next) {
        links.push({ source: fileArr[i], target: next, inCycle: true });
      }
    }
  }

  const nodes: DepNode[] = Array.from(nodeSet).map((id) => ({
    id,
    inCycle: cycleNodes.has(id),
  }));

  return { nodes, links };
}

function shortenPath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return '.../' + parts.slice(-2).join('/');
}

export function DepGraphViz({ findings }: DepGraphVizProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [ForceGraph, setForceGraph] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
  const [dimensions, setDimensions] = React.useState({ width: 600, height: 400 });

  // Dynamic import for react-force-graph-2d (it uses Canvas/browser APIs)
  React.useEffect(() => {
    import('react-force-graph-2d').then((mod) => {
      setForceGraph(() => mod.default);
    });
  }, []);

  // Track container dimensions
  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: Math.max(400, entry.contentRect.height),
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const graphData = React.useMemo(() => buildGraphData(findings), [findings]);

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-muted-foreground text-sm">
        No dependency data available for graph visualization.
      </div>
    );
  }

  const nodeColor = (node: DepNode) => {
    if (node.inCycle) return '#ef4444'; // red for cycle nodes
    return isDark ? '#38bdf8' : '#2563eb';
  };

  const linkColor = (link: DepLink) => {
    if (link.inCycle) return 'rgba(239, 68, 68, 0.6)'; // red for cycle edges
    return isDark ? 'rgba(161, 161, 170, 0.3)' : 'rgba(113, 113, 122, 0.3)';
  };

  return (
    <div ref={containerRef} className="min-h-[400px] h-[400px] w-full relative">
      {ForceGraph ? (
        <ForceGraph
          graphData={graphData}
          nodeId="id"
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="transparent"
          nodeColor={nodeColor}
          nodeRelSize={6}
          nodeLabel={(node: DepNode) => shortenPath(node.id)}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(node: DepNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const label = shortenPath(node.id);
            const fontSize = Math.max(10 / globalScale, 3);
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = isDark ? '#a1a1aa' : '#71717a';
            ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + 8 / globalScale);
          }}
          linkColor={linkColor}
          linkWidth={(link: DepLink) => (link.inCycle ? 2 : 1)}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkDirectionalParticles={(link: DepLink) => (link.inCycle ? 2 : 0)}
          linkDirectionalParticleColor={() => '#ef4444'}
          linkDirectionalParticleWidth={3}
          cooldownTicks={60}
          enableZoomInteraction={true}
          enablePanInteraction={true}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading graph...
        </div>
      )}
      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-4 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded-md px-3 py-1.5 border border-border">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-red-500" />
          In cycle
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: isDark ? '#38bdf8' : '#2563eb' }}
          />
          Normal
        </span>
      </div>
    </div>
  );
}
