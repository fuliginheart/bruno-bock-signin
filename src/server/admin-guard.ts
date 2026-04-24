/**
 * Helper for admin API routes — verifies the session cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, verifySession } from "@/server/auth";

export function requireAdmin(req: NextRequest): NextResponse | null {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!verifySession(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
