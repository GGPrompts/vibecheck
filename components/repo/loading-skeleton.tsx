'use client';

import { Skeleton } from '@/components/ui/skeleton';

export function RepoLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="flex gap-6">
        <Skeleton className="h-32 w-32 rounded-full" />
        <div className="space-y-3 flex-1">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-6 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}
