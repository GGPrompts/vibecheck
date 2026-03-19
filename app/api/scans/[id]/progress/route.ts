import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { scans, moduleResults } from '@/lib/db/schema';
import { scanEvents } from '@/lib/modules/orchestrator';
import type { ScanProgress } from '@/lib/modules/orchestrator';

/**
 * GET /api/scans/[id]/progress — SSE stream for scan progress events.
 *
 * If the scan already completed before the client connects, sends the
 * final state from the DB immediately so the UI doesn't get stuck.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: scanId } = await params;

  // Check if scan already finished before SSE connects
  const scan = db.select({ status: scans.status }).from(scans).where(eq(scans.id, scanId)).get();
  const alreadyDone = scan && (scan.status === 'completed' || scan.status === 'failed');

  let listenerRef: ((progress: ScanProgress) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send an initial keepalive comment so the client knows we're connected
      controller.enqueue(encoder.encode(': connected\n\n'));

      // If scan already completed, send module results from DB and close
      if (alreadyDone) {
        const results = db
          .select({ moduleId: moduleResults.moduleId })
          .from(moduleResults)
          .where(eq(moduleResults.scanId, scanId))
          .all();

        for (const r of results) {
          const data = JSON.stringify({
            moduleId: r.moduleId,
            status: 'complete',
            progress: 100,
            message: 'Done',
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        controller.close();
        return;
      }

      const listener = (progress: ScanProgress) => {
        if (progress.scanId !== scanId) return;

        const data = JSON.stringify({
          moduleId: progress.moduleId,
          status: progress.status,
          progress: progress.progress,
          message: progress.message,
        });

        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream closed, clean up
          if (listenerRef) {
            scanEvents.offProgress(listenerRef);
            listenerRef = null;
          }
        }
      };

      listenerRef = listener;
      scanEvents.onProgress(listener);
    },
    cancel() {
      if (listenerRef) {
        scanEvents.offProgress(listenerRef);
        listenerRef = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
