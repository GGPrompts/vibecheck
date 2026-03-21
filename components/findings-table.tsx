'use client';

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
// Button import removed — unused
import {
  CircleAlert,
  TriangleAlert,
  Diamond,
  Info,
  Circle,
  ArrowUpDown,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
interface FindingRow {
  id: string;
  severity: string;
  filePath: string | null;
  line: number | null;
  message: string;
  category: string;
  status: string;
  moduleId?: string;
}

interface FindingsTableProps {
  findings: FindingRow[];
}

type SortField = 'severity' | 'filePath' | 'line' | 'message' | 'moduleId' | 'status';
type SortDir = 'asc' | 'desc';

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const STATUS_ORDER: Record<string, number> = {
  new: 0,
  regressed: 1,
  recurring: 2,
  fixed: 3,
};

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity as Severity) {
    case 'critical':
      return <CircleAlert className="size-4 text-red-500" />;
    case 'high':
      return <TriangleAlert className="size-4 text-orange-500" />;
    case 'medium':
      return <Diamond className="size-4 text-yellow-500" />;
    case 'low':
      return <Info className="size-4 text-blue-500" />;
    case 'info':
      return <Circle className="size-4 text-gray-400" />;
    default:
      return <Circle className="size-4 text-gray-400" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    recurring: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    fixed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    regressed: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        styles[status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
      )}
    >
      {status}
    </span>
  );
}

function truncatePath(path: string | null, maxLen = 40): string {
  if (!path) return '(unknown)';
  if (path.length <= maxLen) return path;
  return '...' + path.slice(path.length - maxLen + 3);
}

function SortableHeader({
  field,
  onToggle,
  children,
}: {
  field: SortField;
  onToggle: (field: SortField) => void;
  children: React.ReactNode;
}) {
  return (
    <TableHead>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onToggle(field)}
      >
        {children}
        <ArrowUpDown className="size-3 opacity-50" />
      </button>
    </TableHead>
  );
}

export function FindingsTable({ findings }: FindingsTableProps) {
  const [sortField, setSortField] = React.useState<SortField>('severity');
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');

  const [severityFilter, setSeverityFilter] = React.useState<string>('all');
  const [moduleFilter, setModuleFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');

  // Derive unique modules
  const modules = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) {
      if (f.moduleId) set.add(f.moduleId);
    }
    return Array.from(set).sort();
  }, [findings]);

  // Derive unique severities
  const severities = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) set.add(f.severity);
    return Array.from(set).sort(
      (a, b) => (SEVERITY_ORDER[a] ?? 99) - (SEVERITY_ORDER[b] ?? 99)
    );
  }, [findings]);

  // Derive unique statuses
  const statuses = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) set.add(f.status);
    return Array.from(set).sort(
      (a, b) => (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99)
    );
  }, [findings]);

  // Filter
  const filtered = React.useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
      if (moduleFilter !== 'all' && f.moduleId !== moduleFilter) return false;
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      return true;
    });
  }, [findings, severityFilter, moduleFilter, statusFilter]);

  // Sort
  const sorted = React.useMemo(() => {
    const copy = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;

    copy.sort((a, b) => {
      switch (sortField) {
        case 'severity':
          return dir * ((SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
        case 'filePath':
          return dir * (a.filePath ?? '').localeCompare(b.filePath ?? '');
        case 'line':
          return dir * ((a.line ?? 0) - (b.line ?? 0));
        case 'message':
          return dir * a.message.localeCompare(b.message);
        case 'moduleId':
          return dir * (a.moduleId ?? '').localeCompare(b.moduleId ?? '');
        case 'status':
          return dir * ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
        default:
          return 0;
      }
    });

    return copy;
  }, [filtered, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Filter className="size-4" />
          Filters:
        </div>

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All severities</option>
          {severities.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <span className="text-xs text-muted-foreground">
          {sorted.length} of {findings.length} findings
        </span>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader field="severity" onToggle={toggleSort}>Severity</SortableHeader>
            <SortableHeader field="filePath" onToggle={toggleSort}>File</SortableHeader>
            <SortableHeader field="line" onToggle={toggleSort}>Line</SortableHeader>
            <SortableHeader field="message" onToggle={toggleSort}>Message</SortableHeader>
            <SortableHeader field="moduleId" onToggle={toggleSort}>Module</SortableHeader>
            <SortableHeader field="status" onToggle={toggleSort}>Status</SortableHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No findings match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((f) => (
              <TableRow key={f.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <SeverityIcon severity={f.severity} />
                    <span className="capitalize text-xs">{f.severity}</span>
                  </div>
                </TableCell>
                <TableCell
                  className="max-w-[240px] truncate font-mono text-xs"
                  title={f.filePath ?? undefined}
                >
                  {truncatePath(f.filePath)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {f.line ?? '-'}
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-xs" title={f.message}>
                  {f.message}
                </TableCell>
                <TableCell className="text-xs">{f.moduleId ?? '-'}</TableCell>
                <TableCell>
                  <StatusBadge status={f.status} />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
