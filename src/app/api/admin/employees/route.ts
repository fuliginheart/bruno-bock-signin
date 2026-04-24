import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ulid } from "ulid";
import { requireAdmin } from "@/server/admin-guard";
import { listEmployees } from "@/server/queries";
import { applyMutation, ReplicationError } from "@/server/mutations";

export const dynamic = "force-dynamic";

const UpsertInput = z.object({
  id: z.string().min(8).optional(),
  displayName: z.string().min(1).max(120),
  active: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  return NextResponse.json(listEmployees());
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const body = await req.json().catch(() => null);
  const parsed = UpsertInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const id = parsed.data.id ?? ulid();
  try {
    const ev = await applyMutation({
      action: "employee_upsert",
      payload: {
        id,
        displayName: parsed.data.displayName,
        active: parsed.data.active ?? true,
      },
    });
    return NextResponse.json({ ok: true, id, eventId: ev.id });
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

export async function DELETE(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  try {
    await applyMutation({
      action: "employee_delete",
      payload: { id },
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
