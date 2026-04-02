"use client";

import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  PROFILES,
  getProfileLabel,
  type ProjectProfile,
} from "@/lib/config/profiles";

const PROFILE_OPTIONS = (Object.keys(PROFILES) as ProjectProfile[]).map((key) => ({
  value: key,
  label: getProfileLabel(key),
  description: PROFILES[key].description,
}));

interface ProfileSelectorProps {
  projectProfile: string;
  onProfileChange: (value: string) => void;
}

export function ProfileSelector({
  projectProfile,
  onProfileChange,
}: ProfileSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Repo Archetype</CardTitle>
        <CardDescription>
          Override the auto-detected repo shape when you want different
          module relevance and weighting defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="project-profile">Archetype</Label>
          <select
            id="project-profile"
            value={projectProfile}
            onChange={(e) => onProfileChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {PROFILE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          {PROFILE_OPTIONS.find((p) => p.value === projectProfile)?.description}
        </p>
        <p className="text-xs text-muted-foreground">
          Auto-detect remains the default. Saving here sets a manual override in your global settings.
        </p>
      </CardContent>
    </Card>
  );
}
