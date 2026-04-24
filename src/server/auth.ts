/**
 * Simple admin session: a signed cookie containing an HMAC of the issued
 * timestamp. PIN is verified server-side; if valid we set the cookie.
 *
 * Cookie value: `<issuedMs>.<hmac>` (hmac of issuedMs using a derived key)
 */
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { config } from "./config";

const COOKIE_NAME = "bb_admin";
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function sessionKey(): string {
  // Derive a key from the admin PIN hash (which is per-install secret).
  // If PIN isn't yet set, fall back to a per-process random key (sessions
  // won't survive restart — fine for first-run).
  return config.adminPinHash || _bootKey;
}

const _bootKey = randomBytes(32).toString("hex");

export function issueSession(): string {
  const issued = Date.now().toString();
  const mac = createHmac("sha256", sessionKey()).update(issued).digest("hex");
  return `${issued}.${mac}`;
}

export function verifySession(value: string | undefined | null): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const issued = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const issuedMs = Number(issued);
  if (!Number.isFinite(issuedMs)) return false;
  if (Date.now() - issuedMs > SESSION_TTL_MS) return false;
  const expected = createHmac("sha256", sessionKey())
    .update(issued)
    .digest("hex");
  return expected === mac;
}

export function getStoredPinHash(): string | null {
  const db = getDb();
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, "admin_pin_hash"))
    .get();
  return row?.value ?? config.adminPinHash ?? null;
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
