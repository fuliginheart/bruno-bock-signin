import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin-guard";
import { applyMutation } from "@/server/mutations";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const db = getDb();
  const rows = db.select().from(settings).all();
  return NextResponse.json(
    rows.map((r) => ({
      key: r.key,
      value: r.value,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}

const PutInput = z.object({
  key: z.string().min(1).max(100),
  value: z.string().min(0).max(500),
});

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PutInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  await applyMutation({
    action: "setting_set",
    payload: { key: parsed.data.key, value: parsed.data.value },
  });

  return NextResponse.json({ ok: true });
}
