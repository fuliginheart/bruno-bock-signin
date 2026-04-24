/**
 * POST /api/presence/toggle
 * Body: { subjectType, subjectId, desired: "on_site" | "off_site" }
 *
 * Idempotent: if the subject is already in the desired state, returns 200
 * with `noop: true` rather than appending a redundant event.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { presence } from "@/db/schema";
import { applyMutation, ReplicationError } from "@/server/mutations";

export const dynamic = "force-dynamic";

const Input = z.object({
  subjectType: z.enum(["employee", "visitor"]),
  subjectId: z.string().min(1),
  desired: z.enum(["on_site", "off_site"]),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { subjectType, subjectId, desired } = parsed.data;

  // Idempotency check against local DB. A follower may briefly disagree
  // with the leader, but the leader will perform the same check.
  const db = getDb();
  const current = db
    .select()
    .from(presence)
    .where(
      and(
        eq(presence.subjectType, subjectType),
        eq(presence.subjectId, subjectId),
      ),
    )
    .get();
  const isOn = current?.onSite ?? false;
  const wantOn = desired === "on_site";
  if (isOn === wantOn) {
    return NextResponse.json({ noop: true });
  }

  try {
    const ev = await applyMutation({
      action: wantOn ? "sign_in" : "sign_out",
      subjectType,
      subjectId,
      payload: { subjectType, subjectId, desired },
    });
    return NextResponse.json({
      ok: true,
      event: { ...ev, createdAt: ev.createdAt.toISOString() },
    });
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
