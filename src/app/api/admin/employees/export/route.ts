import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin-guard";
import { listEmployees } from "@/server/queries";

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

  const rows = listEmployees();
  const header = ["id", "displayName", "active", "createdAt", "updatedAt"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.displayName,
        row.active ? "true" : "false",
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bruno-bock-employees-${Date.now()}.csv"`,
    },
  });
}
