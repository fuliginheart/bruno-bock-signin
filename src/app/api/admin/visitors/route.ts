import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/admin-guard";
import { listVisitors } from "@/server/queries";
import { applyMutation, ReplicationError } from "@/server/mutations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  return NextResponse.json(
    listVisitors().map((v) => ({
      ...v,
      since: v.since instanceof Date ? v.since.getTime() : v.since,
      createdAt: v.createdAt.getTime(),
      updatedAt: v.updatedAt.getTime(),
      deletedAt: v.deletedAt ? v.deletedAt.getTime() : null,
    })),
  );
}

export async function DELETE(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  try {
    await applyMutation({ action: "visitor_delete", payload: { id } });
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

const PatchInput = z.object({
  id: z.string().min(1),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  company: z.string().min(1).max(120).optional(),
  reason: z.string().min(1).max(500).optional(),
  hostEmployeeId: z.string().min(1).nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const body = await req.json().catch(() => null);
  const parsed = PatchInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    await applyMutation({
      action: "visitor_update",
      subjectType: "visitor",
      subjectId: parsed.data.id,
      payload: parsed.data,
    });
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
