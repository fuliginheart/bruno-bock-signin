/**
 * GET /api/settings/sounds
 * Public endpoint — returns the configured sound URLs so the roster page
 * can play them without admin auth.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function getSetting(key: string): string {
  const db = getDb();
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? "";
}

export async function GET() {
  return NextResponse.json({
    signIn: getSetting("sound_sign_in") || null,
    signOut: getSetting("sound_sign_out") || null,
  });
}
