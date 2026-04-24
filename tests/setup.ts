/**
 * Per-worker env shim for tests.
 *
 * Gives each test worker a unique DB path + media path under os.tmpdir() so
 * tests never collide with each other or with the developer's dev database.
 * Runs BEFORE any imports of src/server/config.ts.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const workerId = process.env.VITEST_POOL_ID ?? "0";
const root = fs.mkdtempSync(
  path.join(os.tmpdir(), `bb-test-${process.pid}-${workerId}-`),
);

process.env.KIOSK_ID ??= `test-kiosk-${workerId}`;
process.env.KIOSK_NAME ??= `Test Kiosk ${workerId}`;
process.env.LEADER_DISCOVERY ??= "";
process.env.ADMIN_PIN_HASH ??= "";
process.env.DB_PATH = path.join(root, "db.sqlite");
process.env.MEDIA_PATH = path.join(root, "media");
process.env.LOG_DIR = path.join(root, "logs");
process.env.LOG_LEVEL = "silent";
process.env.PORT ??= "3999";
process.env.HOSTNAME ??= "127.0.0.1";

// Expose the temp root so per-test helpers can reset state if needed.
(globalThis as Record<string, unknown>).__BB_TEST_ROOT__ = root;
