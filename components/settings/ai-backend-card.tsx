"use client";

import { Check, X, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AiBackendCardProps {
  aiProvider: "api" | "cli" | "auto";
  checkingCli: boolean;
  cliAvailable: boolean | null;
  hasApiKey: boolean;
  onProviderChange: (value: "api" | "cli" | "auto") => void;
}

export function AiBackendCard({
  aiProvider,
  checkingCli,
  cliAvailable,
  hasApiKey,
  onProviderChange,
}: AiBackendCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Backend</CardTitle>
        <CardDescription>
          Choose how Vibecheck connects to Claude for AI analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Claude Code (CLI) option */}
        <button
          type="button"
          onClick={() => onProviderChange("cli")}
          className={`w-full rounded-lg border p-4 text-left transition-colors ${
            aiProvider === "cli"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Claude Code (Max plan)</span>
                {aiProvider === "cli" && (
                  <Badge variant="secondary">Selected</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Uses <code className="text-xs">claude -p</code> subprocess. No API key needed, no cost tracking.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {checkingCli ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : cliAvailable ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-green-600">Available</span>
                </>
              ) : (
                <>
                  <X className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-red-600">Not found</span>
                </>
              )}
            </div>
          </div>
        </button>

        {/* API Key option */}
        <button
          type="button"
          onClick={() => onProviderChange("api")}
          className={`w-full rounded-lg border p-4 text-left transition-colors ${
            aiProvider === "api"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">API Key</span>
                {aiProvider === "api" && (
                  <Badge variant="secondary">Selected</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Uses @anthropic-ai/sdk. Shows token usage and cost tracking.
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {hasApiKey ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-green-600">Available</span>
                </>
              ) : (
                <>
                  <X className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-red-600">No key</span>
                </>
              )}
            </div>
          </div>
        </button>

        {/* Auto option */}
        <button
          type="button"
          onClick={() => onProviderChange("auto")}
          className={`w-full rounded-lg border p-4 text-left transition-colors ${
            aiProvider === "auto"
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/50"
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Auto-detect</span>
              {aiProvider === "auto" && (
                <Badge variant="secondary">Selected</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Try Claude Code first (free), fall back to API key if unavailable.
            </p>
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
