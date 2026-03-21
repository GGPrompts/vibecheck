"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"

interface ActivityPanelContextValue {
  visible: boolean
  toggle: () => void
}

const ActivityPanelContext = createContext<ActivityPanelContextValue | null>(null)

export function ActivityPanelProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false)

  const toggle = useCallback(() => {
    setVisible((prev) => !prev)
  }, [])

  return (
    <ActivityPanelContext value={{ visible, toggle }}>
      {children}
    </ActivityPanelContext>
  )
}

export function useActivityPanel(): ActivityPanelContextValue {
  const ctx = useContext(ActivityPanelContext)
  if (!ctx) {
    throw new Error("useActivityPanel must be used within an ActivityPanelProvider")
  }
  return ctx
}
