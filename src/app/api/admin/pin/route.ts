import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/admin-guard";
import { hashPin } from "@/server/pin";
import { applyMutation, ReplicationError } from "@/server/mutations";

export const dynamic = "force-dynamic";

const Input = z.object({
  newPin: z.string().min(4).max(32),
});

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
  }
  const hash = hashPin(parsed.data.newPin);
  try {
    await applyMutation({
      action: "setting_set",
      payload: { key: "admin_pin_hash", value: hash },
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
