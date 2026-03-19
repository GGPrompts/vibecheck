import { scanEvents } from '@/lib/modules/orchestrator';
import type { ScanProgress } from '@/lib/modules/orchestrator';

/**
 * GET /api/scans/[id]/progress — SSE stream for scan progress events.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: scanId } = await params;

  let listenerRef: ((progress: ScanProgress) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

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

      // Send an initial keepalive comment so the client knows we're connected
      controller.enqueue(encoder.encode(': connected\n\n'));
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
