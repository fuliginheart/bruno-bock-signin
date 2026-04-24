import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin-guard";
import { listAuditEvents } from "@/server/queries";
import { type SubjectType } from "@/db/schema";

export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const subjectType = url.searchParams.get("subjectType") as SubjectType | null;
  const subjectId = url.searchParams.get("subjectId") ?? undefined;
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));
  const limit = Number(url.searchParams.get("limit") ?? 1000);

  const events = listAuditEvents({
    subjectType: subjectType ?? undefined,
    subjectId,
    from,
    to,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 1000,
  });

  return NextResponse.json(
    events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  );
}
