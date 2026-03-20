import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { audits } from '@/lib/db/schema';

/**
 * POST /api/audits/[id]/control — Control a running audit.
 * Body: { action: 'stop' }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action } = body as { action: string };

    if (action !== 'stop') {
      return NextResponse.json(
        { error: 'Unsupported action. Valid actions: stop' },
        { status: 400 }
      );
    }

    const audit = db.select().from(audits).where(eq(audits.id, id)).get();
    if (!audit) {
      return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
    }

    // Update status to failed (actual process signaling will come later)
    db.update(audits)
      .set({ status: 'failed' })
      .where(eq(audits.id, id))
      .run();

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
