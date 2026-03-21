"use client"

import {
  AlertCircle,
  AlertTriangle,
  Bug,
  Info,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type {
  StreamBlock,
  TextBlock,
} from "@/components/audit-context"

// ── Log entry type ──

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  id: string
  timestamp: Date
  level: LogLevel
  message: string
  source?: string
}

// ── Level config ──

interface LevelConfig {
  icon: LucideIcon
  color: string
  bg: string
  border: string
  label: string
}

const LEVEL_CONFIGS: Record<LogLevel, LevelConfig> = {
  debug: {
    icon: Bug,
    color: "text-slate-400",
    bg: "bg-slate-500/20",
    border: "border-slate-500/30",
    label: "DBG",
  },
  info: {
    icon: Info,
    color: "text-blue-400",
    bg: "bg-blue-500/20",
    border: "border-blue-500/30",
    label: "INF",
  },
  warn: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bg: "bg-amber-500/20",
    border: "border-amber-500/30",
    label: "WRN",
  },
  error: {
    icon: AlertCircle,
    color: "text-red-400",
    bg: "bg-red-500/20",
    border: "border-red-500/30",
    label: "ERR",
  },
}

export function getLevelConfig(level: LogLevel): LevelConfig {
  return LEVEL_CONFIGS[level]
}

// ── Transform stream blocks into log entries ──

let logIdCounter = 0

function getToolHint(input: Record<string, unknown>): string {
  const candidates = ["command", "file_path", "pattern", "path", "query"]
  for (const key of candidates) {
    const val = input[key]
    if (typeof val === "string" && val.length > 0) {
      return val.length > 80 ? val.slice(0, 77) + "..." : val
    }
  }
  return ""
}

export function blockToLogEntry(block: StreamBlock): LogEntry {
  logIdCounter += 1
  const id = `log-${logIdCounter}-${Date.now()}`
  const timestamp = new Date()

  switch (block.kind) {
    case "text":
      return { id, timestamp, level: "info", message: block.text, source: "audit" }
    case "thinking":
      return { id, timestamp, level: "debug", message: block.text, source: "thinking" }
    case "tool_use": {
      const hint = getToolHint(block.input)
      return {
        id,
        timestamp,
        level: "info",
        message: `[tool] ${block.toolName}${hint ? `: ${hint}` : ""}`,
        source: "tool",
      }
    }
    case "tool_result":
      return {
        id,
        timestamp,
        level: block.isError ? "error" : "debug",
        message: block.isError
          ? `[tool error] ${block.text.slice(0, 200)}`
          : `[tool result] ${block.text.slice(0, 200)}`,
        source: "tool",
      }
  }
}

export function mergeTextBlocks(blocks: StreamBlock[]): StreamBlock[] {
  const merged: StreamBlock[] = []
  for (const block of blocks) {
    if (
      block.kind === "text" &&
      merged.length > 0 &&
      merged[merged.length - 1].kind === "text"
    ) {
      const prev = merged[merged.length - 1] as TextBlock
      merged[merged.length - 1] = { kind: "text", text: prev.text + block.text }
    } else {
      merged.push(block)
    }
  }
  return merged
}

// ── Format helpers ──

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

// ── Log entry row component ──

export function LogEntryRow({ entry }: { entry: LogEntry }) {
  const config = getLevelConfig(entry.level)
  return (
    <div
      className={`flex items-start gap-2 px-3 py-0.5 hover:bg-muted/30 transition-colors border-l-2 ${config.border}`}
    >
      <span className="text-muted-foreground shrink-0 w-[60px] tabular-nums">
        {formatTime(entry.timestamp)}
      </span>
      <span
        className={`shrink-0 w-[32px] font-bold ${config.color}`}
      >
        {config.label}
      </span>
      <span className="text-foreground whitespace-pre-wrap break-all min-w-0">
        {entry.message}
      </span>
    </div>
  )
}
