/**
 * Unit tests for the event reducer (appendEvent / applyRemoteEvent / applyEffect).
 *
 * Each test gets a fresh in-memory-backed temp SQLite file via setup.ts,
 * then resets that file between tests.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import { ulid } from "ulid";

import { ensureMigrated } from "@/db/migrate";
import { closeDb, getDb } from "@/db/client";
import {
  appendEvent,
  applyRemoteEvent,
  readEventsSince,
  type StoredEvent,
} from "@/server/events";
import {
  employees,
  presence,
  visitors,
  settings,
  ACTION_SIGN_IN,
  ACTION_SIGN_OUT,
  ACTION_EMPLOYEE_UPSERT,
  ACTION_EMPLOYEE_DELETE,
  ACTION_VISITOR_REGISTER,
  ACTION_VISITOR_UPDATE,
  ACTION_VISITOR_DELETE,
  ACTION_SETTING_SET,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { config } from "@/server/config";

function resetDb() {
  closeDb();
  try {
    for (const ext of ["", "-wal", "-shm"]) {
      const p = config.dbPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch {
    /* ignore */
  }
  ensureMigratedFresh();
}

// Bypass the module-level `migrated` guard by re-requiring migrate-once logic
// through a fresh invocation. Since closeDb resets the singleton, running
// ensureMigrated will re-apply migrations to the new file.
let alreadyMigratedOnce = false;
function ensureMigratedFresh() {
  if (alreadyMigratedOnce) {
    // The `migrated` flag in migrate.ts lives in module scope and we can't
    // reset it without re-importing. Instead apply migrations manually.
    const { migrate } = require("drizzle-orm/better-sqlite3/migrator") as typeof import("drizzle-orm/better-sqlite3/migrator");
    const path = require("node:path") as typeof import("node:path");
    migrate(getDb(), {
      migrationsFolder: path.resolve(process.cwd(), "src/db/migrations"),
    });
    return;
  }
  ensureMigrated();
  alreadyMigratedOnce = true;
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  closeDb();
});

describe("appendEvent — employees", () => {
  it("upserts an employee row and assigns a monotonic seq", () => {
    const e1 = appendEvent({
      action: ACTION_EMPLOYEE_UPSERT,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: { id: "emp-1", displayName: "Alice" },
    });
    const e2 = appendEvent({
      action: ACTION_EMPLOYEE_UPSERT,
      subjectType: "employee",
      subjectId: "emp-2",
      payload: { id: "emp-2", displayName: "Bob" },
    });
    expect(e2.seq).toBeGreaterThan(e1.seq);

    const rows = getDb().select().from(employees).all();
    expect(rows.map((r) => r.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("soft-deletes an employee", () => {
    appendEvent({
      action: ACTION_EMPLOYEE_UPSERT,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: { id: "emp-1", displayName: "Alice" },
    });
    appendEvent({
      action: ACTION_EMPLOYEE_DELETE,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: { id: "emp-1" },
    });
    const row = getDb()
      .select()
      .from(employees)
      .where(eq(employees.id, "emp-1"))
      .get();
    expect(row?.active).toBe(false);
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("appendEvent — presence", () => {
  beforeEach(() => {
    appendEvent({
      action: ACTION_EMPLOYEE_UPSERT,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: { id: "emp-1", displayName: "Alice" },
    });
  });

  it("sign_in creates presence row with onSite=true", () => {
    appendEvent({
      action: ACTION_SIGN_IN,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: { subjectType: "employee", subjectId: "emp-1", desired: "on_site" },
    });
    const row = getDb()
      .select()
      .from(presence)
      .where(eq(presence.subjectId, "emp-1"))
      .get();
    expect(row?.onSite).toBe(true);
    expect(row?.since).toBeInstanceOf(Date);
  });

  it("sign_out flips onSite=false", () => {
    appendEvent({
      action: ACTION_SIGN_IN,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: {},
    });
    appendEvent({
      action: ACTION_SIGN_OUT,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: {},
    });
    const row = getDb()
      .select()
      .from(presence)
      .where(eq(presence.subjectId, "emp-1"))
      .get();
    expect(row?.onSite).toBe(false);
  });
});

describe("appendEvent — visitors", () => {
  it("registers, updates, and soft-deletes a visitor", () => {
    appendEvent({
      action: ACTION_VISITOR_REGISTER,
      subjectType: "visitor",
      subjectId: "vis-1",
      payload: {
        id: "vis-1",
        firstName: "Vic",
        lastName: "Tor",
        company: "Acme",
        reason: "Meeting",
        hostEmployeeId: null,
        photoPath: "p.jpg",
        signaturePath: "s.png",
      },
    });
    appendEvent({
      action: ACTION_VISITOR_UPDATE,
      subjectType: "visitor",
      subjectId: "vis-1",
      payload: { id: "vis-1", company: "Acme Corp" },
    });
    let row = getDb()
      .select()
      .from(visitors)
      .where(eq(visitors.id, "vis-1"))
      .get();
    expect(row?.company).toBe("Acme Corp");
    expect(row?.firstName).toBe("Vic");

    appendEvent({
      action: ACTION_VISITOR_DELETE,
      subjectType: "visitor",
      subjectId: "vis-1",
      payload: { id: "vis-1" },
    });
    row = getDb()
      .select()
      .from(visitors)
      .where(eq(visitors.id, "vis-1"))
      .get();
    expect(row?.deletedAt).not.toBeNull();
  });
});

describe("appendEvent — settings", () => {
  it("setting_set upserts a settings row", () => {
    appendEvent({
      action: ACTION_SETTING_SET,
      payload: { key: "foo", value: "bar" },
    });
    appendEvent({
      action: ACTION_SETTING_SET,
      payload: { key: "foo", value: "baz" },
    });
    const row = getDb()
      .select()
      .from(settings)
      .where(eq(settings.key, "foo"))
      .get();
    expect(row?.value).toBe("baz");
  });
});

describe("applyRemoteEvent — idempotency", () => {
  function remoteEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
    return {
      seq: 0,
      id: ulid(),
      subjectType: "employee",
      subjectId: "emp-remote",
      action: ACTION_EMPLOYEE_UPSERT,
      kioskId: "peer-kiosk",
      createdAt: new Date(),
      payload: { id: "emp-remote", displayName: "Remote" },
      ...overrides,
    };
  }

  it("applies a new remote event and reports applied=true", () => {
    const ev = remoteEvent();
    expect(applyRemoteEvent(ev)).toBe(true);
    const row = getDb()
      .select()
      .from(employees)
      .where(eq(employees.id, "emp-remote"))
      .get();
    expect(row?.displayName).toBe("Remote");
  });

  it("is a no-op when the same event id arrives twice", () => {
    const ev = remoteEvent({
      payload: { id: "emp-remote", displayName: "First" },
    });
    expect(applyRemoteEvent(ev)).toBe(true);

    // Re-apply with a MUTATED payload but same id — must not overwrite.
    const duplicate: StoredEvent = {
      ...ev,
      payload: { id: "emp-remote", displayName: "Overwrite" },
    };
    expect(applyRemoteEvent(duplicate)).toBe(false);

    const row = getDb()
      .select()
      .from(employees)
      .where(eq(employees.id, "emp-remote"))
      .get();
    expect(row?.displayName).toBe("First");
  });
});

describe("readEventsSince", () => {
  it("returns only events strictly newer than afterSeq, in order", () => {
    const evs: StoredEvent[] = [];
    for (let i = 0; i < 5; i++) {
      evs.push(
        appendEvent({
          action: ACTION_EMPLOYEE_UPSERT,
          subjectType: "employee",
          subjectId: `emp-${i}`,
          payload: { id: `emp-${i}`, displayName: `E${i}` },
        }),
      );
    }
    const mid = evs[2].seq;
    const tail = readEventsSince(mid);
    expect(tail.map((e) => e.seq)).toEqual([evs[3].seq, evs[4].seq]);
    expect(tail[0].action).toBe(ACTION_EMPLOYEE_UPSERT);
    expect(tail[0].payload).toMatchObject({ id: "emp-3" });
  });
});
