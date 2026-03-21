import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { runBatchScan, cancelBatch, batchEvents } from '@/lib/modules/batch-orchestrator';
import type { BatchProgress } from '@/lib/modules/batch-orchestrator';
import '@/lib/modules/register-all';

/**
 * POST /api/scans/batch — Start a batch scan.
 * Body: { repoIds: string[] | 'all', aiEnabled?: boolean }
 * Returns immediately with a batchId.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repoIds, aiEnabled } = body as {
      repoIds: string[] | 'all';
      aiEnabled?: boolean;
    };

    if (repoIds !== 'all' && !Array.isArray(repoIds)) {
      return NextResponse.json(
        { error: 'repoIds must be an array of strings or "all"' },
        { status: 400 }
      );
    }

    if (Array.isArray(repoIds) && repoIds.some((id) => typeof id !== 'string')) {
      return NextResponse.json(
        { error: 'All repoIds must be strings' },
        { status: 400 }
      );
    }

    const batchId = nanoid();

    // Detach from route handler's async context so Next.js sends
    // the 202 response immediately instead of waiting for the scan.
    setTimeout(() => {
      runBatchScan(repoIds, {
        enableAi: aiEnabled,
        batchId,
      }).catch((err) => {
        console.error('Batch scan failed:', err);
      });
    }, 0);

    return NextResponse.json({ batchId }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /api/scans/batch?batchId=xxx — SSE stream for batch progress events.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get('batchId');

  if (!batchId) {
    return NextResponse.json(
      { error: 'batchId query parameter is required' },
      { status: 400 }
    );
  }

  let progressRef: ((progress: BatchProgress) => void) | null = null;
  let doneRef: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const onProgress = (progress: BatchProgress) => {
        const data = JSON.stringify(progress);
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          cleanup();
        }
      };

      const onDone = () => {
        try {
          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          controller.close();
        } catch {
          // Stream already closed
        }
        cleanup();
      };

      function cleanup() {
        if (progressRef) {
          batchEvents.offProgress(batchId!, progressRef);
          progressRef = null;
        }
        if (doneRef) {
          batchEvents.offDone(batchId!, doneRef);
          doneRef = null;
        }
      }

      progressRef = onProgress;
      doneRef = onDone;

      batchEvents.onProgress(batchId, onProgress);
      batchEvents.onDone(batchId, onDone);

      // Send an initial keepalive comment so the client knows we're connected
      controller.enqueue(encoder.encode(': connected\n\n'));
    },
    cancel() {
      if (progressRef) {
        batchEvents.offProgress(batchId!, progressRef);
        progressRef = null;
      }
      if (doneRef) {
        batchEvents.offDone(batchId!, doneRef);
        doneRef = null;
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

/**
 * DELETE /api/scans/batch — Cancel an active batch scan.
 * Body: { batchId: string }
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { batchId } = body as { batchId: string };

    if (!batchId || typeof batchId !== 'string') {
      return NextResponse.json(
        { error: 'batchId is required and must be a string' },
        { status: 400 }
      );
    }

    const cancelled = cancelBatch(batchId);
    return NextResponse.json({ cancelled });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
