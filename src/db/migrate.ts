/**
 * Run Drizzle migrations from src/db/migrations.
 * Invoked by `npm run db:migrate` and by the Next.js boot path.
 */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { settings } from "./schema";
import { config } from "@/server/config";
import { hashPin } from "@/server/pin";

let migrated = false;

function seedAdminPin() {
  const db = getDb();
  const existing = db
    .select()
    .from(settings)
    .where(eq(settings.key, "admin_pin_hash"))
    .get();
  if (existing) return;
  const value = config.adminPinHash || hashPin("0000");
  db.insert(settings)
    .values({ key: "admin_pin_hash", value, updatedAt: new Date() })
    .onConflictDoNothing()
    .run();
  // eslint-disable-next-line no-console
  if (!config.adminPinHash) {
    console.warn(
      "WARNING: admin PIN was not configured; defaulted to '0000'. Change it in /admin/pin.",
    );
  }
}

export function ensureMigrated() {
  if (migrated) return;
  const migrationsFolder = path.resolve(process.cwd(), "src/db/migrations");
  if (!fs.existsSync(migrationsFolder)) {
    migrated = true;
    return;
  }
  migrate(getDb(), { migrationsFolder });
  seedAdminPin();
  migrated = true;
}

if (require.main === module) {
  ensureMigrated();
  // eslint-disable-next-line no-console
  console.log("Migrations applied.");
}
