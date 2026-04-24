import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/server/admin-guard";
import { config } from "@/server/config";
import { getMaxSeq } from "@/server/events";
import { getState } from "@/server/replication/state";
import { runElection } from "@/server/replication/coordinator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const s = getState();
  return NextResponse.json({
    self: {
      kioskId: config.kioskId,
      name: config.kioskName,
      role: s.role,
      lastSeq: getMaxSeq(),
    },
    leader: {
      id: s.leaderId,
      url: s.leaderUrl,
      lastHeartbeat: s.lastLeaderHeartbeat,
    },
    peers: config.peers,
  });
}

const ActionInput = z.object({
  action: z.enum(["promote", "elect"]),
});

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;
  const body = await req.json().catch(() => null);
  const parsed = ActionInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  if (parsed.data.action === "promote") {
    // Force re-election: this kiosk has the highest priority by lexicographic
    // tiebreak only if no peer has a higher seq. Caller should know risks.
    void runElection();
    return NextResponse.json({ ok: true, message: "Election triggered." });
  }
  if (parsed.data.action === "elect") {
    void runElection();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
