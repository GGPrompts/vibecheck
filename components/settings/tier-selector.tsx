"use client";

import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TIERS, type ScanTier } from "@/lib/config/tiers";

const SCAN_TIER_OPTIONS = (Object.keys(TIERS) as ScanTier[]).map((key) => ({
  value: key,
  label: key,
  description: TIERS[key].description,
}));

interface TierSelectorProps {
  scanTier: string;
  onTierChange: (value: string) => void;
}

export function TierSelector({
  scanTier,
  onTierChange,
}: TierSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan Tier</CardTitle>
        <CardDescription>
          Controls how thoroughly Vibecheck scans: which models run,
          parallelism, coverage depth, and whether cross-model
          verification is enabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="scan-tier">Tier</Label>
          <select
            id="scan-tier"
            value={scanTier}
            onChange={(e) => onTierChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {SCAN_TIER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          {SCAN_TIER_OPTIONS.find((t) => t.value === scanTier)?.description}
        </p>
      </CardContent>
    </Card>
  );
}
