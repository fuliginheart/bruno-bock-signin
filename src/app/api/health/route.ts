/**
 * Health endpoint for monitoring & install-script verification.
 */
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { getMaxSeq } from "@/server/events";
import { getState } from "@/server/replication/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = getState();
  return NextResponse.json({
    ok: true,
    kioskId: config.kioskId,
    name: config.kioskName,
    role: s.role,
    leaderId: s.leaderId,
    leaderUrl: s.leaderUrl,
    lastSeq: getMaxSeq(),
    lastLeaderHeartbeat: s.lastLeaderHeartbeat,
    peers: config.peers,
    now: Date.now(),
  });
}
