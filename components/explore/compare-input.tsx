"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CompareInputProps {
  inputValue: string;
  inputError: string | null;
  disabled: boolean;
  onInputChange: (value: string) => void;
  onAdd: () => void;
}

export function CompareInput({
  inputValue,
  inputError,
  disabled,
  onInputChange,
  onAdd,
}: CompareInputProps) {
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        onAdd();
      }
    },
    [onAdd],
  );

  return (
    <div className="flex items-start gap-2 max-w-lg">
      <div className="flex-1 space-y-1">
        <div className="flex gap-2">
          <Input
            placeholder="owner/repo or GitHub URL..."
            value={inputValue}
            onChange={(e) => {
              onInputChange(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            className="h-9"
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="default"
            onClick={onAdd}
            disabled={disabled || !inputValue.trim()}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {inputError && (
          <p className="text-xs text-destructive">{inputError}</p>
        )}
      </div>
    </div>
  );
}
