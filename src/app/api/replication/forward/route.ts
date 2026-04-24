/**
 * Endpoint a follower POSTs to in order to apply a mutation on the leader.
 * Only accepts requests when this node is the leader.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendEvent } from "@/server/events";
import { getState } from "@/server/replication/state";

export const dynamic = "force-dynamic";

const ForwardInput = z.object({
  action: z.string().min(1),
  subjectType: z.enum(["employee", "visitor"]).nullable().optional(),
  subjectId: z.string().nullable().optional(),
  payload: z.record(z.unknown()),
});

export async function POST(req: NextRequest) {
  if (getState().role !== "leader") {
    return NextResponse.json(
      { error: "Not the leader." },
      { status: 421 }, // Misdirected Request
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = ForwardInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const stored = appendEvent({
    action: parsed.data.action as never,
    subjectType: parsed.data.subjectType ?? null,
    subjectId: parsed.data.subjectId ?? null,
    payload: parsed.data.payload,
  });
  return NextResponse.json({
    ...stored,
    createdAt: stored.createdAt.toISOString(),
  });
}
