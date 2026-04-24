/**
 * Admin PIN hashing using node:crypto scrypt (no native deps).
 * Format: scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;
const SALTLEN = 16;

export function hashPin(pin: string): string {
  if (!pin || pin.length < 4) {
    throw new Error("PIN must be at least 4 characters.");
  }
  const salt = randomBytes(SALTLEN);
  const hash = scryptSync(pin, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPin(pin: string, encoded: string): boolean {
  if (!encoded) return false;
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
