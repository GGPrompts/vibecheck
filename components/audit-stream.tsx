"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useAudit, type StreamBlock, type TextBlock } from "./audit-context";

// ── Types ──

interface AuditStreamProps {
  /** Optional — if omitted the component reads from the global audit context. */
  auditId?: string;
  /** @deprecated Ignored. Streaming state is managed by AuditProvider. */
  isActive?: boolean;
  onComplete?: () => void;
}

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

// ── Component ──

export function AuditStream({ onComplete }: AuditStreamProps) {
  const { blocks, isStreaming, onComplete: subscribeComplete } = useAudit();
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // ── Subscribe to completion callback ──

  useEffect(() => {
    if (!onComplete) return;
    return subscribeComplete(onComplete);
  }, [onComplete, subscribeComplete]);

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
    setShowScrollBtn(!isNearBottom && isStreaming);
  }, [isStreaming]);

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
      {isStreaming && (
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
        {mergedBlocks.length === 0 && isStreaming && (
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
