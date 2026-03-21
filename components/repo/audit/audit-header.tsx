'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Code,
  Play,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AuditHeaderProps {
  repoId: string;
  activeAuditId: string | null;
  auditStarting: boolean;
  exportingFormat: string | null;
  onRunAudit: () => void;
  onStopAudit: () => void;
  onExport: (format: 'markdown' | 'html') => void;
}

export function AuditHeader({
  repoId,
  activeAuditId,
  auditStarting,
  exportingFormat,
  onRunAudit,
  onStopAudit,
  onExport,
}: AuditHeaderProps) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <Link
          href={`/repo/${repoId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to repository
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Audit Trail</h1>
        <p className="text-muted-foreground">
          Complete scan history and compliance reporting
        </p>
      </div>

      <div className="flex gap-2 mt-6">
        {activeAuditId ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onStopAudit}
          >
            <Square className="h-4 w-4 mr-1.5" />
            Stop Audit
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onRunAudit}
            disabled={auditStarting}
          >
            <Play className="h-4 w-4 mr-1.5" />
            {auditStarting ? 'Starting...' : 'Run Audit'}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport('markdown')}
          disabled={exportingFormat !== null}
        >
          <FileText className="h-4 w-4 mr-1.5" />
          {exportingFormat === 'markdown' ? 'Generating...' : 'Export Markdown'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExport('html')}
          disabled={exportingFormat !== null}
        >
          <Code className="h-4 w-4 mr-1.5" />
          {exportingFormat === 'html' ? 'Generating...' : 'Export HTML'}
        </Button>
      </div>
    </div>
  );
}
