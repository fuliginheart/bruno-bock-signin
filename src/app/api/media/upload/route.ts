/**
 * Receives visitor media uploaded by a follower kiosk so the leader can store
 * a primary copy. Best-effort warmup; on-demand fetch covers the missed case.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveVisitorMedia } from "@/server/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Input = z.object({
  visitorId: z.string().min(8),
  photoDataUrl: z.string().startsWith("data:image/"),
  signatureDataUrl: z.string().startsWith("data:image/"),
  originKioskId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  await saveVisitorMedia(
    parsed.data.visitorId,
    parsed.data.photoDataUrl,
    parsed.data.signatureDataUrl,
  );
  return NextResponse.json({ ok: true });
}
