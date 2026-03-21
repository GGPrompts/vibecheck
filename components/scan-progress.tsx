"use client";

import { useEffect, useState, useRef } from "react";

interface ModuleProgress {
  moduleId: string;
  status: "running" | "complete" | "error";
  progress: number;
  message?: string;
}

interface ScanProgressProps {
  scanId: string;
  onComplete?: () => void;
}

export function ScanProgress({ scanId, onComplete }: ScanProgressProps) {
  const [modules, setModules] = useState<Record<string, ModuleProgress>>({});
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/scans/${scanId}/progress`);

    eventSource.onmessage = (event) => {
      try {
        const data: ModuleProgress = JSON.parse(event.data);
        setModules((prev) => {
          const next = { ...prev, [data.moduleId]: data };

          // Check if all modules are complete
          const allValues = Object.values(next);
          if (
            allValues.length > 0 &&
            allValues.every((m) => m.status === "complete" || m.status === "error")
          ) {
            setTimeout(() => {
              onCompleteRef.current?.();
            }, 1000);
          }

          return next;
        });
      } catch {
        // Ignore parse errors (e.g., keepalive comments)
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [scanId]);

  const moduleList = Object.values(modules);

  if (moduleList.length === 0) {
    return (
      <div className="space-y-2 p-3 rounded-lg bg-muted/50">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground">Starting scan...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3 rounded-lg bg-muted/50">
      {moduleList.map((mod) => (
        <div key={mod.moduleId} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium capitalize">{mod.moduleId.replace("-", " ")}</span>
            <span className="text-muted-foreground">
              {mod.status === "complete"
                ? "Done"
                : mod.status === "error"
                  ? "Error"
                  : `${Math.round(mod.progress)}%`}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                mod.status === "error"
                  ? "bg-destructive"
                  : mod.status === "complete"
                    ? "bg-green-500"
                    : "bg-primary"
              }`}
              style={{ width: `${mod.progress}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
