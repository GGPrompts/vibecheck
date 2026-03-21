"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ModuleInfo, ModuleGroup } from "./types";
import { MODULE_GROUP_LABELS, MODULE_GROUP_ORDER } from "./types";

interface ModuleTogglesCardProps {
  modules: ModuleInfo[];
  enabledModules: string[];
  onToggleModule: (moduleId: string) => void;
}

export function ModuleTogglesCard({
  modules,
  enabledModules,
  onToggleModule,
}: ModuleTogglesCardProps) {
  // Group modules by their UI group
  const grouped = MODULE_GROUP_ORDER.reduce(
    (acc, group) => {
      const mods = modules.filter((m) => m.group === group);
      if (mods.length > 0) {
        acc.push({ group, mods });
      }
      return acc;
    },
    [] as { group: ModuleGroup; mods: ModuleInfo[] }[]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis Modules</CardTitle>
        <CardDescription>
          Enable or disable individual analysis modules for scans.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {grouped.map(({ group, mods }) => (
          <div key={group} className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {MODULE_GROUP_LABELS[group]}
            </h4>
            <div className="space-y-3 pl-1">
              {mods.map((mod) => (
                <div
                  key={mod.id}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{mod.name}</Label>
                    <p className="text-xs text-muted-foreground">
                      {mod.description}
                    </p>
                  </div>
                  <Switch
                    checked={enabledModules.includes(mod.id)}
                    onCheckedChange={() => onToggleModule(mod.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        {modules.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading modules...</p>
        )}
      </CardContent>
    </Card>
  );
}
