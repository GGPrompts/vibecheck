"use client";

import { Plus } from "lucide-react";

export function CompareEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-16 text-center">
      <Plus className="h-12 w-12 text-muted-foreground/30 mb-4" />
      <p className="text-lg font-medium text-muted-foreground">
        Add repos to compare
      </p>
      <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
        Enter GitHub URLs or owner/repo shorthand above to start comparing
        code health side by side.
      </p>
    </div>
  );
}
