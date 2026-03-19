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
import { MODULE_LIST } from "./types";

interface ModuleTogglesCardProps {
  enabledModules: string[];
  onToggleModule: (moduleId: string) => void;
}

export function ModuleTogglesCard({
  enabledModules,
  onToggleModule,
}: ModuleTogglesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis Modules</CardTitle>
        <CardDescription>
          Enable or disable individual analysis modules for scans.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {MODULE_LIST.map((mod) => (
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
      </CardContent>
    </Card>
  );
}
