"use client"

import {
  Pause,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type LogLevel, type LogEntry, getLevelConfig } from "./log-entry"

// ── Types ──

interface ToolbarProps {
  searchText: string
  onSearchChange: (value: string) => void
  levelFilters: Set<LogLevel>
  onToggleLevel: (level: LogLevel) => void
  levelCounts: Record<LogLevel, number>
  paused: boolean
  onTogglePause: () => void
  onClear: () => void
}

// ── Toolbar component ──

const ALL_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"] as const

export function Toolbar({
  searchText,
  onSearchChange,
  levelFilters,
  onToggleLevel,
  levelCounts,
  paused,
  onTogglePause,
  onClear,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background shrink-0">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={searchText}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Filter logs..."
          className="h-7 pl-7 text-xs bg-muted/30 border-border"
        />
        {searchText && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Level filter toggles */}
      <div className="flex items-center gap-1">
        {ALL_LEVELS.map((level) => {
          const config = getLevelConfig(level)
          const active = levelFilters.has(level)
          const count = levelCounts[level]
          return (
            <button
              key={level}
              onClick={() => onToggleLevel(level)}
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
        onClick={onTogglePause}
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
        onClick={onClear}
        title="Clear logs"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ── Utility: compute level counts from logs ──

export function computeLevelCounts(logs: LogEntry[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 }
  for (const log of logs) {
    counts[log.level]++
  }
  return counts
}
