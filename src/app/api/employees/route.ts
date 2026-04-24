import { NextResponse } from "next/server";
import { listEmployees } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = listEmployees();
  return NextResponse.json(
    rows
      .filter((e) => e.active)
      .map((e) => ({ id: e.id, displayName: e.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
}
