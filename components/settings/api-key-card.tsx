"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ApiKeyCardProps {
  hasApiKey: boolean;
  apiKey: string;
  showApiKey: boolean;
  savingKey: boolean;
  keySaved: boolean;
  onApiKeyChange: (value: string) => void;
  onToggleShow: () => void;
  onSave: () => void;
}

export function ApiKeyCard({
  hasApiKey,
  apiKey,
  showApiKey,
  savingKey,
  keySaved,
  onApiKeyChange,
  onToggleShow,
  onSave,
}: ApiKeyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Anthropic API Key
          {hasApiKey && (
            <Badge variant="secondary">Connected</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Required for AI-powered analysis modules. Your key is stored locally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showApiKey ? "text" : "password"}
              placeholder={hasApiKey ? "Key saved - enter new key to replace" : "sk-ant-..."}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={onToggleShow}
            >
              {showApiKey ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <Button
            onClick={onSave}
            disabled={savingKey || !apiKey.trim()}
          >
            {savingKey ? "Saving..." : keySaved ? "Saved!" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
