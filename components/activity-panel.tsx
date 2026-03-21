"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  Bug,
  ChevronDown,
  ChevronUp,
  Filter,
  GripHorizontal,
  Info,
  Pause,
  Play,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useAudit,
  type StreamBlock,
  type TextBlock,
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

// ── Level config (colors from log-viewer reference) ──

function getLevelConfig(level: LogLevel) {
  switch (level) {
    case "debug":
      return {
        icon: Bug,
        color: "text-slate-400",
        bg: "bg-slate-500/20",
        border: "border-slate-500/30",
        label: "DBG",
      }
    case "info":
      return {
        icon: Info,
        color: "text-blue-400",
        bg: "bg-blue-500/20",
        border: "border-blue-500/30",
        label: "INF",
      }
    case "warn":
      return {
        icon: AlertTriangle,
        color: "text-amber-400",
        bg: "bg-amber-500/20",
        border: "border-amber-500/30",
        label: "WRN",
      }
    case "error":
      return {
        icon: AlertCircle,
        color: "text-red-400",
        bg: "bg-red-500/20",
        border: "border-red-500/30",
        label: "ERR",
      }
  }
}

// ── Transform stream blocks into log entries ──

let logIdCounter = 0

function blockToLogEntry(block: StreamBlock): LogEntry {
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

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

// ── Component ──

const PANEL_COLLAPSED_HEIGHT = 36
const PANEL_DEFAULT_HEIGHT = 280
const PANEL_MIN_HEIGHT = 120
const PANEL_MAX_HEIGHT = 600

export function ActivityPanel({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  const { blocks, isStreaming, activeAuditId } = useAudit()

  const [expanded, setExpanded] = useState(false)
  const [panelHeight, setPanelHeight] = useState(PANEL_DEFAULT_HEIGHT)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [levelFilters, setLevelFilters] = useState<Set<LogLevel>>(
    new Set(["debug", "info", "warn", "error"])
  )
  const [showFilters, setShowFilters] = useState(false)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const prevBlockCountRef = useRef(0)
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)

  // ── Convert new blocks to log entries ──

  useEffect(() => {
    if (paused) return
    const newBlocks = blocks.slice(prevBlockCountRef.current)
    if (newBlocks.length === 0) {
      // blocks was reset (new audit) — clear logs
      if (blocks.length < prevBlockCountRef.current) {
        setLogs([])
        prevBlockCountRef.current = 0
      }
      return
    }
    prevBlockCountRef.current = blocks.length

    // Merge consecutive text blocks before converting
    const merged: StreamBlock[] = []
    for (const block of newBlocks) {
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

    const entries = merged
      .map(blockToLogEntry)
      .filter((e) => e.message.trim().length > 0)

    setLogs((prev) => [...prev, ...entries].slice(-500))
  }, [blocks, paused])

  // ── Auto-scroll ──

  useEffect(() => {
    if (userScrolledRef.current || paused) return
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs, paused])

  // ── Scroll detection ──

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNearBottom = distFromBottom < 40
    userScrolledRef.current = !isNearBottom
    setShowScrollBtn(!isNearBottom && logs.length > 0)
  }, [logs.length])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    userScrolledRef.current = false
    setShowScrollBtn(false)
  }, [])

  // ── Filtered logs ──

  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (!levelFilters.has(entry.level)) return false
      if (searchText) {
        const q = searchText.toLowerCase()
        if (
          !entry.message.toLowerCase().includes(q) &&
          !(entry.source || "").toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
  }, [logs, levelFilters, searchText])

  // ── Level toggle ──

  const toggleLevel = (level: LogLevel) => {
    setLevelFilters((prev) => {
      const next = new Set(prev)
      if (next.has(level)) {
        next.delete(level)
      } else {
        next.add(level)
      }
      return next
    })
  }

  // ── Drag to resize ──

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      dragStartYRef.current = e.clientY
      dragStartHeightRef.current = panelHeight

      const handleMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return
        const delta = dragStartYRef.current - ev.clientY
        const newHeight = Math.min(
          PANEL_MAX_HEIGHT,
          Math.max(PANEL_MIN_HEIGHT, dragStartHeightRef.current + delta)
        )
        setPanelHeight(newHeight)
      }

      const handleUp = () => {
        isDraggingRef.current = false
        window.removeEventListener("mousemove", handleMove)
        window.removeEventListener("mouseup", handleUp)
      }

      window.addEventListener("mousemove", handleMove)
      window.addEventListener("mouseup", handleUp)
    },
    [panelHeight]
  )

  // ── Clear logs ──

  const clearLogs = useCallback(() => {
    setLogs([])
    prevBlockCountRef.current = blocks.length
  }, [blocks.length])

  if (!visible) return null

  // ── Level counts for filter badges ──

  const levelCounts = {
    debug: logs.filter((l) => l.level === "debug").length,
    info: logs.filter((l) => l.level === "info").length,
    warn: logs.filter((l) => l.level === "warn").length,
    error: logs.filter((l) => l.level === "error").length,
  }

  return (
    <div className="border-t border-border bg-background">
      {/* ── Drag handle / status bar ── */}
      <div
        className="flex items-center gap-2 px-3 h-9 cursor-ns-resize select-none border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors"
        onMouseDown={expanded ? handleDragStart : undefined}
        onDoubleClick={() => setExpanded(!expanded)}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
          <Terminal className="h-3.5 w-3.5" />
          <span className="font-medium">Activity</span>
        </button>

        {/* Status indicators */}
        <div className="flex items-center gap-2 ml-auto">
          {isStreaming && (
            <div className="flex items-center gap-1.5">
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="h-1.5 w-1.5 rounded-full bg-green-500"
              />
              <span className="text-xs text-green-500 font-mono">LIVE</span>
            </div>
          )}
          {activeAuditId && !isStreaming && (
            <span className="text-xs text-muted-foreground font-mono">IDLE</span>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {logs.length} entries
          </span>
          <button
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Expanded content ── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: panelHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="flex flex-col overflow-hidden"
          >
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background shrink-0">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Filter logs..."
                  className="h-7 pl-7 text-xs bg-muted/30 border-border"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Level filter toggles */}
              <div className="flex items-center gap-1">
                {(["debug", "info", "warn", "error"] as const).map((level) => {
                  const config = getLevelConfig(level)
                  const active = levelFilters.has(level)
                  const count = levelCounts[level]
                  return (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono transition-colors ${
                        active
                          ? `${config.bg} ${config.color}`
                          : "text-muted-foreground/40 bg-transparent"
                      }`}
                      title={`${active ? "Hide" : "Show"} ${level} logs`}
                    >
                      {config.label}
                      {count > 0 && (
                        <span className="text-[10px] opacity-70">{count}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="h-4 w-px bg-border" />

              {/* Pause/Resume */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setPaused(!paused)}
                title={paused ? "Resume live tail" : "Pause live tail"}
              >
                {paused ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
              </Button>

              {/* Clear */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={clearLogs}
                title="Clear logs"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Log entries */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto overflow-x-hidden font-mono text-xs"
            >
              {filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                  {logs.length === 0
                    ? "No activity yet. Start an audit to see live output."
                    : "No logs match the current filters."}
                </div>
              ) : (
                filteredLogs.map((entry) => {
                  const config = getLevelConfig(entry.level)
                  const Icon = config.icon
                  return (
                    <div
                      key={entry.id}
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
                })
              )}
            </div>

            {/* Jump to bottom */}
            <AnimatePresence>
              {showScrollBtn && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-2 right-4"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs shadow-lg"
                    onClick={scrollToBottom}
                  >
                    <ArrowDown className="h-3 w-3 mr-1" />
                    Jump to bottom
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
