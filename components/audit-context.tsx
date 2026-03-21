"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// ── Types (shared with audit-stream.tsx) ──

export interface TextBlock {
  kind: "text";
  text: string;
}

export interface ThinkingBlock {
  kind: "thinking";
  text: string;
}

export interface ToolUseBlock {
  kind: "tool_use";
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  kind: "tool_result";
  toolId: string;
  text: string;
  isError: boolean;
}

export type StreamBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

// ── Parse JSONL line into StreamBlock ──

function parseJsonlLine(line: string): StreamBlock | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }

  const type = obj.type as string | undefined;

  if (type === "text") {
    return { kind: "text", text: (obj.text as string) || "" };
  }

  if (type === "thinking") {
    return {
      kind: "thinking",
      text: (obj.thinking as string) || (obj.text as string) || "",
    };
  }

  if (type === "tool_use") {
    return {
      kind: "tool_use",
      toolName: (obj.name as string) || "Tool",
      toolId: (obj.id as string) || "",
      input: (obj.input as Record<string, unknown>) || {},
    };
  }

  if (type === "tool_result") {
    let resultText = "";
    const content = obj.content;
    if (typeof content === "string") {
      resultText = content;
    } else if (Array.isArray(content)) {
      resultText = content
        .filter((c: Record<string, unknown>) => c && c.text)
        .map((c: Record<string, unknown>) => c.text as string)
        .join("\n");
    }
    return {
      kind: "tool_result",
      toolId: (obj.tool_use_id as string) || "",
      text: resultText,
      isError: (obj.is_error as boolean) || false,
    };
  }

  // If it has a text field but no recognized type, treat as text
  if (typeof obj.text === "string") {
    return { kind: "text", text: obj.text };
  }

  return null;
}

// ── Context Shape ──

interface AuditContextValue {
  /** The currently streaming audit ID, or null if idle. */
  activeAuditId: string | null;
  /** Accumulated stream blocks for the active audit. */
  blocks: StreamBlock[];
  /** Whether the SSE stream is currently connected and active. */
  isStreaming: boolean;
  /** Start streaming for the given audit ID. */
  startAudit: (auditId: string) => void;
  /** Stop streaming and clear active audit state. */
  stopAudit: () => void;
  /** Register a callback for when an audit completes. Returns unsubscribe fn. */
  onComplete: (cb: () => void) => () => void;
}

const AuditContext = createContext<AuditContextValue | null>(null);

// ── Provider ──

export function AuditProvider({ children }: { children: ReactNode }) {
  const [activeAuditId, setActiveAuditId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingBlocksRef = useRef<StreamBlock[]>([]);
  const lastFlushRef = useRef(0);
  const completeCallbacksRef = useRef<Set<() => void>>(new Set());

  // ── Flush pending blocks with 1s throttle via rAF ──

  const scheduleFlushRef = useRef<() => void>(() => {});

  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      const now = Date.now();
      const elapsed = now - lastFlushRef.current;

      if (elapsed < 1000 && pendingBlocksRef.current.length > 0) {
        rafIdRef.current = null;
        setTimeout(() => scheduleFlushRef.current(), 1000 - elapsed);
        return;
      }

      if (pendingBlocksRef.current.length > 0) {
        const toFlush = [...pendingBlocksRef.current];
        pendingBlocksRef.current = [];
        lastFlushRef.current = now;

        setBlocks((prev) => [...prev, ...toFlush]);
      }

      rafIdRef.current = null;
    });
  }, []);

  useEffect(() => {
    scheduleFlushRef.current = scheduleFlush;
  }, [scheduleFlush]);

  // ── Teardown helper ──

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // ── Start audit streaming ──

  const startAudit = useCallback(
    (auditId: string) => {
      // Tear down any existing stream
      closeStream();

      // Reset state for new audit
      setActiveAuditId(auditId);
      setBlocks([]);
      pendingBlocksRef.current = [];
      lastFlushRef.current = 0;
      setIsStreaming(true);

      const es = new EventSource(`/api/audits/${auditId}/progress`);
      eventSourceRef.current = es;

      // Handle named "chunk" events — raw text streaming
      es.addEventListener("chunk", (event: MessageEvent) => {
        const block: StreamBlock = { kind: "text", text: event.data };
        pendingBlocksRef.current.push(block);
        scheduleFlush();
      });

      // Handle named "progress" events — progress JSON with status
      es.addEventListener("progress", (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status === "complete" || data.status === "error") {
            // Flush anything remaining immediately
            if (pendingBlocksRef.current.length > 0) {
              const remaining = [...pendingBlocksRef.current];
              pendingBlocksRef.current = [];
              setBlocks((prev) => [...prev, ...remaining]);
            }
            if (data.status === "complete") {
              setTimeout(() => {
                for (const cb of completeCallbacksRef.current) {
                  cb();
                }
              }, 500);
            }
          }
        } catch {
          // ignore
        }
      });

      // Handle default/unnamed events — JSONL lines
      es.onmessage = (event: MessageEvent) => {
        const line = event.data;
        if (!line) return;

        const block = parseJsonlLine(line);
        if (block) {
          pendingBlocksRef.current.push(block);
          scheduleFlush();
        }
      };

      es.onerror = () => {
        // Flush remaining on error/close
        if (pendingBlocksRef.current.length > 0) {
          const remaining = [...pendingBlocksRef.current];
          pendingBlocksRef.current = [];
          setBlocks((prev) => [...prev, ...remaining]);
        }
        es.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
      };
    },
    [closeStream, scheduleFlush]
  );

  // ── Stop audit streaming ──

  const stopAudit = useCallback(() => {
    closeStream();
    setActiveAuditId(null);
    setBlocks([]);
    pendingBlocksRef.current = [];
  }, [closeStream]);

  // ── onComplete subscription ──

  const onComplete = useCallback((cb: () => void) => {
    completeCallbacksRef.current.add(cb);
    return () => {
      completeCallbacksRef.current.delete(cb);
    };
  }, []);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return (
    <AuditContext value={{
      activeAuditId,
      blocks,
      isStreaming,
      startAudit,
      stopAudit,
      onComplete,
    }}>
      {children}
    </AuditContext>
  );
}

// ── Hook ──

export function useAudit(): AuditContextValue {
  const ctx = useContext(AuditContext);
  if (!ctx) {
    throw new Error("useAudit must be used within an AuditProvider");
  }
  return ctx;
}
