"use client"

import { motion } from "framer-motion"
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  X,
} from "lucide-react"

interface StatusBarProps {
  expanded: boolean
  onToggleExpand: () => void
  onDragStart: ((e: React.MouseEvent) => void) | undefined
  isStreaming: boolean
  activeAuditId: string | null
  logCount: number
  onClose: () => void
}

export function StatusBar({
  expanded,
  onToggleExpand,
  onDragStart,
  isStreaming,
  activeAuditId,
  logCount,
  onClose,
}: StatusBarProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 h-9 cursor-ns-resize select-none border-b border-border bg-muted/30 hover:bg-muted/50 transition-colors"
      onMouseDown={onDragStart}
      onDoubleClick={onToggleExpand}
    >
      <button
        onClick={onToggleExpand}
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
          {logCount} entries
        </span>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
