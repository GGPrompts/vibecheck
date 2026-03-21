"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAudit } from "@/components/audit-context"
import {
  type LogLevel,
  type LogEntry,
  blockToLogEntry,
  mergeTextBlocks,
  LogEntryRow,
} from "@/components/activity-panel/log-entry"
import { Toolbar, computeLevelCounts } from "@/components/activity-panel/toolbar"
import { StatusBar } from "@/components/activity-panel/status-bar"

// Re-export types for consumers

// ── Constants ──

const PANEL_DEFAULT_HEIGHT = 280
const PANEL_MIN_HEIGHT = 120
const PANEL_MAX_HEIGHT = 600

// ── Component ──

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
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)
  const prevBlockCountRef = useRef(0)
  const isDraggingRef = useRef(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)
  const [lastAuditId, setLastAuditId] = useState<string | null>(null)

  // Reset logs when a new audit starts — adjust state during render (React-recommended pattern)
  if (activeAuditId !== lastAuditId) {
    setLastAuditId(activeAuditId)
    if (activeAuditId !== null) {
      setLogs([])
    }
  }

  // Reset block counter when audit changes
  useEffect(() => {
    prevBlockCountRef.current = 0
  }, [activeAuditId])

  // Convert new blocks to log entries
  useEffect(() => {
    if (paused) return

    const newBlocks = blocks.slice(prevBlockCountRef.current)
    if (newBlocks.length === 0) return
    prevBlockCountRef.current = blocks.length

    const merged = mergeTextBlocks(newBlocks)
    const entries = merged
      .map(blockToLogEntry)
      .filter((e) => e.message.trim().length > 0)

    setLogs((prev) => [...prev, ...entries].slice(-500))
  }, [blocks, paused])

  // Auto-scroll
  useEffect(() => {
    if (userScrolledRef.current || paused) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, paused])

  // Scroll detection
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

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((entry) => {
      if (!levelFilters.has(entry.level)) return false
      if (searchText) {
        const q = searchText.toLowerCase()
        return (
          entry.message.toLowerCase().includes(q) ||
          (entry.source || "").toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [logs, levelFilters, searchText])

  // Level toggle
  const toggleLevel = useCallback((level: LogLevel) => {
    setLevelFilters((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }, [])

  // Drag to resize
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

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([])
    prevBlockCountRef.current = blocks.length
  }, [blocks.length])

  // Level counts
  const levelCounts = useMemo(() => computeLevelCounts(logs), [logs])

  if (!visible) return null

  const toggleExpand = () => setExpanded(!expanded)

  return (
    <div className="border-t border-border bg-background">
      <StatusBar
        expanded={expanded}
        onToggleExpand={toggleExpand}
        onDragStart={expanded ? handleDragStart : undefined}
        isStreaming={isStreaming}
        activeAuditId={activeAuditId}
        logCount={logs.length}
        onClose={onToggle}
      />

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: panelHeight, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="flex flex-col overflow-hidden"
          >
            <Toolbar
              searchText={searchText}
              onSearchChange={setSearchText}
              levelFilters={levelFilters}
              onToggleLevel={toggleLevel}
              levelCounts={levelCounts}
              paused={paused}
              onTogglePause={() => setPaused(!paused)}
              onClear={clearLogs}
            />

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
                filteredLogs.map((entry) => (
                  <LogEntryRow key={entry.id} entry={entry} />
                ))
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
