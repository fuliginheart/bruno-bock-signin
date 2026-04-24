import { NextRequest, NextResponse } from "next/server";
import { readVisitorMedia } from "@/server/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string }> },
) {
  const { id, kind } = await ctx.params;
  if (kind !== "photo" && kind !== "signature") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
    return NextResponse.json({ error: "Invalid visitor id" }, { status: 400 });
  }
  try {
    const buf = await readVisitorMedia(id, kind);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 404 },
    );
  }
}
