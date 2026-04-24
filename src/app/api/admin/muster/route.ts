import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin-guard";
import { getMusterList } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  return NextResponse.json(
    getMusterList().map((m) => ({
      ...m,
      since: m.since instanceof Date ? m.since.getTime() : m.since,
    })),
  );
}
