"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface SliderProps {
  className?: string
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?: (value: number[]) => void
  disabled?: boolean
}

function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  disabled = false,
}: SliderProps) {
  const currentValue = value?.[0] ?? defaultValue?.[0] ?? min
  const percentage = ((currentValue - min) / (max - min)) * 100

  return (
    <div
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      data-slot="slider"
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        disabled={disabled}
        onChange={(e) => {
          onValueChange?.([Number(e.target.value)])
        }}
        className="sr-only"
        aria-label="Slider"
      />
      <div
        className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted cursor-pointer"
        onClick={(e) => {
          if (disabled) return
          const rect = e.currentTarget.getBoundingClientRect()
          const pct = (e.clientX - rect.left) / rect.width
          const newValue = Math.round((min + pct * (max - min)) / step) * step
          onValueChange?.([Math.max(min, Math.min(max, newValue))])
        }}
      >
        <div
          className="h-full bg-primary"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div
        className="absolute block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
        style={{ left: `calc(${percentage}% - 6px)` }}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={currentValue}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault()
            onValueChange?.([Math.min(max, currentValue + step)])
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault()
            onValueChange?.([Math.max(min, currentValue - step)])
          }
        }}
      />
    </div>
  )
}

export { Slider }
export type { SliderProps }
