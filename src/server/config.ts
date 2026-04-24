/**
 * Centralized config + env validation.
 * Throws clearly at boot if required values are missing.
 */
import { z } from "zod";
import path from "node:path";

const EnvSchema = z.object({
  KIOSK_ID: z.string().min(1, "KIOSK_ID is required"),
  KIOSK_NAME: z.string().min(1).default("Unnamed Kiosk"),
  LEADER_DISCOVERY: z.string().default(""),
  ADMIN_PIN_HASH: z.string().default(""),
  DB_PATH: z.string().default("./data/db.sqlite"),
  MEDIA_PATH: z.string().default("./data/media"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOSTNAME: z.string().default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  LOG_DIR: z.string().default("./data/logs"),
});

function loadEnv() {
  // Defer parsing so build-time tooling without env still imports cleanly.
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  kioskId: env.KIOSK_ID,
  kioskName: env.KIOSK_NAME,
  peers: env.LEADER_DISCOVERY.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  adminPinHash: env.ADMIN_PIN_HASH,
  dbPath: path.resolve(process.cwd(), env.DB_PATH),
  mediaPath: path.resolve(process.cwd(), env.MEDIA_PATH),
  port: env.PORT,
  hostname: env.HOSTNAME,
  logLevel: env.LOG_LEVEL,
  logDir: path.resolve(process.cwd(), env.LOG_DIR),
} as const;

export type AppConfig = typeof config;
