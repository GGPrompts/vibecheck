"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ── Types ──

interface AuditStreamProps {
  auditId: string;
  isActive: boolean;
  onComplete?: () => void;
}

interface TextBlock {
  kind: "text";
  text: string;
}

interface ThinkingBlock {
  kind: "thinking";
  text: string;
}

interface ToolUseBlock {
  kind: "tool_use";
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  kind: "tool_result";
  toolId: string;
  text: string;
  isError: boolean;
}

type StreamBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

// ── Simple Markdown Renderer ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSimpleMarkdown(text: string): string {
  if (!text) return "";

  // Split on fenced code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part) => {
      // Fenced code block
      if (part.startsWith("```") && part.endsWith("```")) {
        const inner = part.slice(3, -3);
        // Strip optional language identifier from first line
        const newlineIdx = inner.indexOf("\n");
        const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
        return `<pre class="my-2 rounded-md bg-muted p-3 overflow-x-auto text-xs"><code>${escapeHtml(code)}</code></pre>`;
      }

      // Inline rendering for non-code-block text
      let escaped = escapeHtml(part);

      // Inline code
      escaped = escaped.replace(
        /`([^`]+)`/g,
        '<code class="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">$1</code>'
      );

      // Bold
      escaped = escaped.replace(
        /\*\*(.+?)\*\*/g,
        "<strong>$1</strong>"
      );

      // Convert newlines to <br> for non-empty lines
      escaped = escaped.replace(/\n/g, "<br />");

      return escaped;
    })
    .join("");
}

// ── Tool Input Hint ──

function getToolHint(input: Record<string, unknown>): string {
  const candidates = ["command", "file_path", "pattern", "path", "query"];
  for (const key of candidates) {
    const val = input[key];
    if (typeof val === "string" && val.length > 0) {
      return val.length > 80 ? val.slice(0, 77) + "..." : val;
    }
  }
  return "";
}

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

// ── Component ──

export function AuditStream({ auditId, isActive, onComplete }: AuditStreamProps) {
  const [blocks, setBlocks] = useState<StreamBlock[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const userScrolledRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);
  const pendingBlocksRef = useRef<StreamBlock[]>([]);
  const lastFlushRef = useRef(0);

  // ── Flush pending blocks with 1s throttle via rAF ──

  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      const now = Date.now();
      const elapsed = now - lastFlushRef.current;

      if (elapsed < 1000 && pendingBlocksRef.current.length > 0) {
        // Re-schedule after remaining time
        rafIdRef.current = null;
        setTimeout(() => scheduleFlush(), 1000 - elapsed);
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

  // ── SSE Connection ──

  useEffect(() => {
    if (!isActive) return;

    const eventSource = new EventSource(`/api/audits/${auditId}/progress`);

    // Handle named "chunk" events — raw text streaming
    eventSource.addEventListener("chunk", (event: MessageEvent) => {
      const block: StreamBlock = { kind: "text", text: event.data };
      pendingBlocksRef.current.push(block);
      scheduleFlush();
    });

    // Handle named "progress" events — existing progress JSON
    eventSource.addEventListener("progress", (event: MessageEvent) => {
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
            setTimeout(() => onCompleteRef.current?.(), 500);
          }
        }
      } catch {
        // ignore
      }
    });

    // Handle default/unnamed events — JSONL lines
    eventSource.onmessage = (event: MessageEvent) => {
      const line = event.data;
      if (!line) return;

      const block = parseJsonlLine(line);
      if (block) {
        pendingBlocksRef.current.push(block);
        scheduleFlush();
      }
    };

    eventSource.onerror = () => {
      // Flush remaining on error/close
      if (pendingBlocksRef.current.length > 0) {
        const remaining = [...pendingBlocksRef.current];
        pendingBlocksRef.current = [];
        setBlocks((prev) => [...prev, ...remaining]);
      }
      eventSource.close();
    };

    return () => {
      eventSource.close();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [auditId, isActive, scheduleFlush]);

  // ── Auto-scroll ──

  useEffect(() => {
    const container = containerRef.current;
    if (!container || userScrolledRef.current) return;

    container.scrollTop = container.scrollHeight;
  }, [blocks]);

  // ── Scroll detection ──

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 60;

    userScrolledRef.current = !isNearBottom;
    setShowScrollBtn(!isNearBottom && isActive);
  }, [isActive]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    userScrolledRef.current = false;
    setShowScrollBtn(false);
  }, []);

  // ── Merge consecutive text blocks for rendering ──

  const mergedBlocks: StreamBlock[] = [];
  for (const block of blocks) {
    if (
      block.kind === "text" &&
      mergedBlocks.length > 0 &&
      mergedBlocks[mergedBlocks.length - 1].kind === "text"
    ) {
      const prev = mergedBlocks[mergedBlocks.length - 1] as TextBlock;
      mergedBlocks[mergedBlocks.length - 1] = {
        kind: "text",
        text: prev.text + block.text,
      };
    } else {
      mergedBlocks.push(block);
    }
  }

  // ── Render ──

  return (
    <div className="relative">
      {/* Streaming indicator */}
      {isActive && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-muted-foreground">Streaming...</span>
        </div>
      )}

      {/* Stream container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[600px] overflow-y-auto space-y-3 rounded-lg border bg-background p-4"
      >
        {mergedBlocks.length === 0 && isActive && (
          <div className="text-sm text-muted-foreground italic">
            Waiting for output...
          </div>
        )}

        {mergedBlocks.map((block, idx) => {
          if (block.kind === "text") {
            return (
              <div
                key={idx}
                className="text-sm text-foreground prose-sm"
                dangerouslySetInnerHTML={{
                  __html: renderSimpleMarkdown(block.text),
                }}
              />
            );
          }

          if (block.kind === "thinking") {
            return (
              <details
                key={idx}
                className="rounded-md border border-border bg-muted/30"
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground italic hover:text-foreground transition-colors">
                  Thinking...
                </summary>
                <div
                  className="px-3 pb-3 text-sm text-muted-foreground italic"
                  dangerouslySetInnerHTML={{
                    __html: renderSimpleMarkdown(block.text),
                  }}
                />
              </details>
            );
          }

          if (block.kind === "tool_use") {
            const hint = getToolHint(block.input);
            return (
              <details
                key={idx}
                className="rounded-md border border-border bg-muted/40"
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground hover:text-primary transition-colors">
                  <span className="font-mono">{block.toolName}</span>
                  {hint && (
                    <span className="ml-2 text-muted-foreground font-normal">
                      {hint}
                    </span>
                  )}
                </summary>
                <div className="px-3 pb-3">
                  <pre className="rounded-md bg-muted p-3 overflow-x-auto text-xs">
                    <code>
                      {JSON.stringify(block.input, null, 2).length > 2000
                        ? JSON.stringify(block.input, null, 2).slice(0, 2000) +
                          "\n... (truncated)"
                        : JSON.stringify(block.input, null, 2)}
                    </code>
                  </pre>
                </div>
              </details>
            );
          }

          if (block.kind === "tool_result") {
            const displayText =
              block.text.length > 3000
                ? block.text.slice(0, 3000) + "\n... (truncated)"
                : block.text;
            return (
              <details
                key={idx}
                className={`rounded-md border bg-muted/40 ${
                  block.isError
                    ? "border-destructive/50"
                    : "border-border"
                }`}
              >
                <summary
                  className={`cursor-pointer select-none px-3 py-2 text-xs font-medium transition-colors ${
                    block.isError
                      ? "text-destructive hover:text-destructive/80"
                      : "text-foreground hover:text-primary"
                  }`}
                >
                  {block.isError ? "Tool Error" : "Tool Result"}
                </summary>
                {displayText && (
                  <div className="px-3 pb-3">
                    <pre className="rounded-md bg-muted p-3 overflow-x-auto text-xs max-h-[300px] overflow-y-auto">
                      <code>{displayText}</code>
                    </pre>
                  </div>
                )}
              </details>
            );
          }

          return null;
        })}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
