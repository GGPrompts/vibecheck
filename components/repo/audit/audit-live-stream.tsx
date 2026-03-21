'use client';

import { Square } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AuditStream } from '@/components/audit-stream';

interface AuditLiveStreamProps {
  onStop: () => void;
  onComplete: () => void;
}

export function AuditLiveStream({ onStop, onComplete }: AuditLiveStreamProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Live Audit</CardTitle>
            <CardDescription>
              Streaming output from AI audit
            </CardDescription>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={onStop}
          >
            <Square className="h-4 w-4 mr-1.5" />
            Stop
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <AuditStream onComplete={onComplete} />
      </CardContent>
    </Card>
  );
}
