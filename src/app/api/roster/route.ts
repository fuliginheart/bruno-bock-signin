/**
 * GET  -> current roster snapshot.
 */
import { NextResponse } from "next/server";
import { getRoster } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const roster = getRoster();
  return NextResponse.json({
    employees: roster.employees.map((e) => ({
      ...e,
      since: e.since?.getTime() ?? null,
    })),
    visitors: roster.visitors.map((v) => ({
      ...v,
      since: v.since?.getTime() ?? null,
    })),
  });
}
