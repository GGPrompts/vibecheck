import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { audits, auditResults } from '@/lib/db/schema';
import { auditEvents } from '@/lib/audit/event-emitter';
import type { AuditProgress } from '@/lib/audit/event-emitter';

/**
 * GET /api/audits/[id]/progress — SSE stream for audit progress events.
 *
 * If the audit already completed before the client connects, sends the
 * final state from the DB immediately so the UI doesn't get stuck.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: auditId } = await params;

  // Check if audit already finished before SSE connects
  const audit = db.select({ status: audits.status }).from(audits).where(eq(audits.id, auditId)).get();
  const alreadyDone = audit && (audit.status === 'completed' || audit.status === 'failed');

  let listenerRef: ((progress: AuditProgress) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send an initial keepalive comment so the client knows we're connected
      controller.enqueue(encoder.encode(': connected\n\n'));

      // If audit already completed, send module results from DB and close
      if (alreadyDone) {
        const results = db
          .select({ moduleId: auditResults.moduleId })
          .from(auditResults)
          .where(eq(auditResults.auditId, auditId))
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

      const listener = (progress: AuditProgress) => {
        if (progress.auditId !== auditId) return;

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
            auditEvents.offProgress(listenerRef);
            listenerRef = null;
          }
        }
      };

      listenerRef = listener;
      auditEvents.onProgress(listener);
    },
    cancel() {
      if (listenerRef) {
        auditEvents.offProgress(listenerRef);
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
