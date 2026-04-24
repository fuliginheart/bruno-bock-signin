/**
 * Identity endpoint used by peer kiosks during election probing.
 */
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { getMaxSeq } from "@/server/events";
import { getState } from "@/server/replication/state";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    kioskId: config.kioskId,
    name: config.kioskName,
    role: getState().role,
    lastSeq: getMaxSeq(),
  });
}
