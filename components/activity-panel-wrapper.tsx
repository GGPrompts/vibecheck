"use client"

import { ActivityPanel } from "@/components/activity-panel"
import { useActivityPanel } from "@/components/activity-panel-context"

export function ActivityPanelWrapper() {
  const { visible, toggle } = useActivityPanel()
  return <ActivityPanel visible={visible} onToggle={toggle} />
}
