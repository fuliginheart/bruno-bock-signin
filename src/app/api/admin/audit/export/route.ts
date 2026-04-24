import { NextRequest } from "next/server";
import { requireAdmin } from "@/server/admin-guard";
import { listAuditEvents } from "@/server/queries";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const url = new URL(req.url);
  const subjectType = url.searchParams.get("subjectType") as "employee" | "visitor" | null;
  const subjectId = url.searchParams.get("subjectId") ?? undefined;
  const from = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : undefined;
  const to = url.searchParams.get("to")
    ? new Date(url.searchParams.get("to")!)
    : undefined;
  const events = listAuditEvents({
    subjectType: subjectType ?? undefined,
    subjectId,
    from,
    to,
    limit: 100_000,
  });
  const header = [
    "seq",
    "id",
    "createdAt",
    "kioskId",
    "action",
    "subjectType",
    "subjectId",
    "payload",
  ];
  const lines = [header.join(",")];
  for (const e of events) {
    lines.push(
      [
        e.seq,
        e.id,
        e.createdAt.toISOString(),
        e.kioskId,
        e.action,
        e.subjectType ?? "",
        e.subjectId ?? "",
        e.payloadJson,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const body = lines.join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bruno-bock-audit-${Date.now()}.csv"`,
    },
  });
}
