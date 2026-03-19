"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AI_MODULE_LIST, TIER_OPTIONS } from "./types";

interface ModelTiersCardProps {
  globalTier: string;
  moduleTiers: Record<string, string>;
  onGlobalTierChange: (value: string) => void;
  onModuleTiersChange: (value: Record<string, string>) => void;
}

export function ModelTiersCard({
  globalTier,
  moduleTiers,
  onGlobalTierChange,
  onModuleTiersChange,
}: ModelTiersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Tiers</CardTitle>
        <CardDescription>
          Choose which Claude model tier to use for AI analysis. Prices shown are per million tokens (input / output).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Global tier dropdown */}
        <div className="space-y-2">
          <Label htmlFor="global-tier">Global Model Tier</Label>
          <select
            id="global-tier"
            value={globalTier}
            onChange={(e) => onGlobalTierChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} ({t.price})
              </option>
            ))}
          </select>
        </div>

        <Separator />

        {/* Per-module overrides */}
        <div className="space-y-2">
          <Label>Per-Module Overrides</Label>
          <p className="text-xs text-muted-foreground">
            Override the global tier for individual AI modules. &quot;Use global&quot; inherits the global setting.
          </p>
          <div className="space-y-3 mt-2">
            {AI_MODULE_LIST.map((mod) => (
              <div
                key={mod.id}
                className="flex items-center justify-between gap-4"
              >
                <Label className="text-sm font-normal min-w-[140px]">
                  {mod.name}
                </Label>
                <select
                  value={moduleTiers[mod.id] ?? ""}
                  onChange={(e) => {
                    onModuleTiersChange((() => {
                      const next = { ...moduleTiers };
                      if (e.target.value === "") {
                        delete next[mod.id];
                      } else {
                        next[mod.id] = e.target.value;
                      }
                      return next;
                    })());
                  }}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">Use global</option>
                  {TIER_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} ({t.price})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Preset buttons */}
        <div className="space-y-2">
          <Label>Presets</Label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onGlobalTierChange("haiku");
                onModuleTiersChange({});
              }}
            >
              Budget Mode
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onGlobalTierChange("sonnet");
                onModuleTiersChange({});
              }}
            >
              Balanced
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onGlobalTierChange("opus");
                onModuleTiersChange({});
              }}
            >
              Deep Scan
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
