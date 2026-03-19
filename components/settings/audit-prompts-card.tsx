"use client";

import { RotateCcw, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AuditPromptEntry } from "./types";

interface AuditPromptsCardProps {
  auditPrompts: Record<string, AuditPromptEntry>;
  auditPromptsLoading: boolean;
  savingPrompts: boolean;
  promptsSaved: boolean;
  onPromptChange: (moduleId: string, value: string) => void;
  onResetPrompt: (moduleId: string) => void;
  onSavePrompts: () => void;
}

export function AuditPromptsCard({
  auditPrompts,
  auditPromptsLoading,
  savingPrompts,
  promptsSaved,
  onPromptChange,
  onResetPrompt,
  onSavePrompts,
}: AuditPromptsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Audit Prompts
        </CardTitle>
        <CardDescription>
          Customize the system prompts sent to the AI for each audit module.
          Changes affect what the AI focuses on during audits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {auditPromptsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : Object.keys(auditPrompts).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No audit modules available.
          </p>
        ) : (
          <>
            {Object.values(auditPrompts).map((entry) => (
              <div
                key={entry.moduleId}
                className="space-y-2 rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">
                      {entry.name}
                    </Label>
                    {entry.isCustom && (
                      <Badge variant="secondary">Custom</Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onResetPrompt(entry.moduleId)}
                    disabled={!entry.isCustom}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Reset to Default
                  </Button>
                </div>
                <textarea
                  value={entry.prompt}
                  onChange={(e) =>
                    onPromptChange(entry.moduleId, e.target.value)
                  }
                  rows={4}
                  className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y dark:bg-input/30"
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button
                onClick={onSavePrompts}
                disabled={savingPrompts}
                size="sm"
              >
                {savingPrompts
                  ? "Saving..."
                  : promptsSaved
                    ? "Saved!"
                    : "Save All"}
              </Button>
              {promptsSaved && (
                <span className="text-sm text-muted-foreground">
                  Audit prompts have been saved.
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
