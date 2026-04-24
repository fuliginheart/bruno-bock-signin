/**
 * POST /api/admin/visitors/reset
 * Body: { id: string }
 *
 * Signs the visitor out AND clears their trainingConfirmedAt so they must
 * go through the full sign-in wizard (including training re-acknowledgement)
 * the next time they visit.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/server/admin-guard";
import { applyMutation, ReplicationError } from "@/server/mutations";
import { getDb } from "@/db/client";
import { presence } from "@/db/schema";

export const dynamic = "force-dynamic";

const Input = z.object({
  id: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { id } = parsed.data;

  try {
    // 1. Clear training confirmation so they must re-sign next visit.
    await applyMutation({
      action: "visitor_update",
      subjectType: "visitor",
      subjectId: id,
      payload: { id, trainingConfirmedAt: null },
    });

    // 2. Sign them out only if they are currently on-site (idempotent).
    const db = getDb();
    const current = db
      .select()
      .from(presence)
      .where(
        and(eq(presence.subjectType, "visitor"), eq(presence.subjectId, id)),
      )
      .get();

    if (current?.onSite) {
      await applyMutation({
        action: "sign_out",
        subjectType: "visitor",
        subjectId: id,
        payload: { subjectType: "visitor", subjectId: id },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ReplicationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
