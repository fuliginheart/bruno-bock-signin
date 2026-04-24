import { NextRequest, NextResponse } from "next/server";
import { searchVisitors } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters." },
      { status: 400 },
    );
  }
  const results = searchVisitors(q.trim());
  return NextResponse.json(
    results.map((v) => ({
      ...v,
      trainingConfirmedAt: v.trainingConfirmedAt?.toISOString() ?? null,
      createdAt: v.createdAt.toISOString(),
    })),
  );
}
