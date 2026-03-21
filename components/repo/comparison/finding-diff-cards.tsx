'use client';

import {
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Scan,
  Bot,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { BothFlaggedItem, ScanOnlyItem, AuditOnlyItem } from './types';
import { SeverityBadge } from './helpers';

// ---------------------------------------------------------------------------
// Both Flagged
// ---------------------------------------------------------------------------

export function BothFlaggedCard({ items }: { items: BothFlaggedItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          Both Flagged
        </CardTitle>
        <CardDescription>
          Issues identified by both scan and audit -- high confidence findings
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No matched findings between scan and audit.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((item, i) => (
              <div key={i} className="py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={item.scan.severity} />
                  <Badge variant="outline" className="text-xs">
                    {Math.round(item.similarity * 100)}% match
                  </Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="text-sm space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Scan className="h-3 w-3" />
                      Scan
                    </p>
                    <p className="text-sm">{item.scan.message}</p>
                    {item.scan.filePath && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {item.scan.filePath}
                        {item.scan.line != null ? `:${item.scan.line}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Bot className="h-3 w-3" />
                      Audit
                    </p>
                    <p className="text-sm">{item.audit.message}</p>
                    {item.audit.file && (
                      <p className="text-xs text-muted-foreground font-mono">
                        {item.audit.file}
                        {item.audit.line != null
                          ? `:${item.audit.line}`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Scan Only
// ---------------------------------------------------------------------------

export function ScanOnlyCard({ items }: { items: ScanOnlyItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-yellow-600" />
          Scan Only
        </CardTitle>
        <CardDescription>
          Flagged by static analysis but not by AI audit -- may be false
          positives worth reviewing
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No scan-only findings -- audit confirmed all scan results.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((item, i) => (
              <div key={i} className="py-3 flex items-start gap-3">
                <SeverityBadge severity={item.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {item.message}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.moduleId}
                    {item.filePath && (
                      <>
                        {' -- '}
                        <span className="font-mono">
                          {item.filePath}
                          {item.line != null ? `:${item.line}` : ''}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit Only
// ---------------------------------------------------------------------------

export function AuditOnlyCard({ items }: { items: AuditOnlyItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-blue-600" />
          Audit Only
        </CardTitle>
        <CardDescription>
          Caught by AI audit but missed by static analysis -- unique AI
          insights
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No audit-only findings -- static scan caught everything the
            audit found.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((item, i) => (
              <div key={i} className="py-3 flex items-start gap-3">
                <SeverityBadge severity={item.severity} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {item.message}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.moduleId}
                    {item.file && (
                      <>
                        {' -- '}
                        <span className="font-mono">
                          {item.file}
                          {item.line != null ? `:${item.line}` : ''}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
