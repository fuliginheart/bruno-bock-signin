import { NextResponse } from "next/server";
import { getTrainingExpiryDays } from "@/server/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const days = getTrainingExpiryDays();
  return NextResponse.json({ days });
}
