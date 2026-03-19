"use client";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatTokenBudget } from "./types";

interface TokenBudgetCardProps {
  tokenBudget: number;
  onTokenBudgetChange: (value: number) => void;
}

export function TokenBudgetCard({
  tokenBudget,
  onTokenBudgetChange,
}: TokenBudgetCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Token Budget</CardTitle>
        <CardDescription>
          Maximum number of tokens to use per scan for AI analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label>Budget</Label>
          <span className="text-sm font-medium">
            {formatTokenBudget(tokenBudget)}
          </span>
        </div>
        <Slider
          value={[tokenBudget]}
          onValueChange={(val) => {
            const v = Array.isArray(val) ? val[0] : val;
            onTokenBudgetChange(v as number);
          }}
          min={10000}
          max={500000}
          step={10000}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>10K</span>
          <span>500K</span>
        </div>
      </CardContent>
    </Card>
  );
}
