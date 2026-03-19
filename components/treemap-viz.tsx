'use client';

import { useTheme } from 'next-themes';
import { ResponsiveTreeMap } from '@nivo/treemap';

interface TreemapDatum {
  id: string;
  value?: number;
  complexity?: number;
  children?: TreemapDatum[];
}

interface TreemapVizProps {
  metrics: Record<string, number>;
  findings: Array<{
    filePath: string | null;
    message: string;
    severity: string;
  }>;
}

/**
 * Build a treemap data tree from complexity module metrics and findings.
 * Groups files by directory. Size = LOC (lines of code), color = complexity score.
 */
function buildTreemapData(
  metrics: Record<string, number>,
  findings: TreemapVizProps['findings']
): TreemapDatum {
  // Extract per-file complexity from findings messages
  const fileComplexity = new Map<string, { loc: number; complexity: number }>();

  for (const f of findings) {
    if (!f.filePath) continue;

    // Try to parse LOC and complexity from the finding message
    const complexityMatch = f.message.match(/complexity[:\s]+(\d+)/i);
    const locMatch = f.message.match(/(\d+)\s*(?:lines?|LOC)/i);

    const complexity = complexityMatch ? parseInt(complexityMatch[1], 10) : severityToComplexity(f.severity);
    const loc = locMatch ? parseInt(locMatch[1], 10) : 50; // default LOC

    const existing = fileComplexity.get(f.filePath);
    if (existing) {
      existing.complexity = Math.max(existing.complexity, complexity);
      existing.loc += loc;
    } else {
      fileComplexity.set(f.filePath, { loc, complexity });
    }
  }

  // If no file-level data, synthesize from metrics
  if (fileComplexity.size === 0 && Object.keys(metrics).length > 0) {
    const avgComplexity = metrics.avgComplexity ?? metrics.averageComplexity ?? 5;
    const totalLoc = metrics.totalLoc ?? metrics.totalLines ?? metrics.loc ?? 1000;
    const fileCount = metrics.fileCount ?? metrics.filesAnalyzed ?? 10;
    const perFileLoc = Math.max(1, Math.round(totalLoc / fileCount));

    for (let i = 0; i < Math.min(fileCount, 30); i++) {
      fileComplexity.set(`file-${i + 1}`, {
        loc: perFileLoc + Math.round((Math.random() - 0.5) * perFileLoc * 0.5),
        complexity: avgComplexity + Math.round((Math.random() - 0.5) * avgComplexity * 0.6),
      });
    }
  }

  // Group by directory
  const dirMap = new Map<string, TreemapDatum[]>();
  for (const [filePath, data] of fileComplexity) {
    const parts = filePath.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
    const fileName = parts[parts.length - 1];

    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir)!.push({
      id: fileName,
      value: Math.max(1, data.loc),
      complexity: data.complexity,
    });
  }

  const children: TreemapDatum[] = [];
  for (const [dir, files] of dirMap) {
    if (files.length === 1) {
      children.push({ ...files[0], id: `${dir}/${files[0].id}` });
    } else {
      children.push({ id: dir, children: files });
    }
  }

  return { id: 'root', children };
}

function severityToComplexity(severity: string): number {
  switch (severity) {
    case 'critical': return 20;
    case 'high': return 15;
    case 'medium': return 10;
    case 'low': return 5;
    default: return 3;
  }
}

export function TreemapViz({ metrics, findings }: TreemapVizProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const data = buildTreemapData(metrics, findings);

  if (!data.children || data.children.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[300px] text-muted-foreground text-sm">
        No complexity data available for treemap visualization.
      </div>
    );
  }

  const textColor = isDark ? '#a1a1aa' : '#71717a';

  return (
    <div className="min-h-[300px] h-[400px] w-full">
      <ResponsiveTreeMap<TreemapDatum>
        data={data}
        identity="id"
        value="value"
        leavesOnly={true}
        innerPadding={2}
        outerPadding={4}
        margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
        label={(node) => {
          const label = node.id;
          // Only show label if node is large enough
          if (node.width < 60 || node.height < 30) return '';
          return label.length > 15 ? label.slice(0, 12) + '...' : label;
        }}
        labelSkipSize={24}
        labelTextColor={isDark ? '#e4e4e7' : '#18181b'}
        colors={(node) => {
          const complexity = (node.data as TreemapDatum).complexity ?? 5;
          // Map complexity to a color scale: green (low) -> yellow (medium) -> red (high)
          if (complexity >= 15) return isDark ? '#ef4444' : '#dc2626';
          if (complexity >= 10) return isDark ? '#f97316' : '#ea580c';
          if (complexity >= 7) return isDark ? '#eab308' : '#ca8a04';
          if (complexity >= 4) return isDark ? '#22c55e' : '#16a34a';
          return isDark ? '#4ade80' : '#22c55e';
        }}
        nodeOpacity={0.9}
        borderWidth={1}
        borderColor={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
        enableParentLabel={true}
        parentLabelSize={18}
        parentLabelPosition="top"
        parentLabelTextColor={isDark ? '#a1a1aa' : '#71717a'}
        isInteractive={true}
        tooltip={({ node }) => {
          const datum = node.data as TreemapDatum;
          return (
            <div className="rounded-md bg-popover px-3 py-2 text-sm shadow-md border border-border">
              <p className="font-medium text-foreground">{node.id}</p>
              <p className="text-muted-foreground">
                LOC: <span className="font-medium text-foreground">{node.value.toLocaleString()}</span>
              </p>
              {datum.complexity !== undefined && (
                <p className="text-muted-foreground">
                  Complexity: <span className="font-medium text-foreground">{datum.complexity}</span>
                </p>
              )}
            </div>
          );
        }}
        theme={{
          text: {
            fill: textColor,
            fontSize: 11,
          },
          tooltip: {
            container: {
              background: 'transparent',
              padding: 0,
              borderRadius: 0,
              boxShadow: 'none',
            },
          },
        }}
      />
    </div>
  );
}
