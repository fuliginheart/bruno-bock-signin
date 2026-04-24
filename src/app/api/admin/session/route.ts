import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyPin } from "@/server/pin";
import { ADMIN_COOKIE_NAME, getStoredPinHash, issueSession } from "@/server/auth";

export const dynamic = "force-dynamic";

const Input = z.object({ pin: z.string().min(4).max(32) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
  }
  const hash = getStoredPinHash();
  if (!hash) {
    return NextResponse.json(
      { error: "Admin PIN not set on this kiosk." },
      { status: 500 },
    );
  }
  if (!verifyPin(parsed.data.pin, hash)) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  const token = issueSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE_NAME);
  return res;
}
