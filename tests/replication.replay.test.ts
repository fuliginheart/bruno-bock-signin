/**
 * Replication replay test.
 *
 * Simulates: a leader has produced a stream of events; a follower that
 * starts from an empty DB and applies those events via applyRemoteEvent
 * must converge to the same derived state (employees, presence, visitors,
 * settings) as the leader. This is the invariant the catch-up mechanism
 * in follower-client relies on.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import { closeDb } from "@/db/client";
import * as dbClient from "@/db/client";
import {
  appendEvent,
  applyRemoteEvent,
  readEventsSince,
} from "@/server/events";
import {
  employees,
  events,
  presence,
  visitors,
  settings,
  ACTION_SIGN_IN,
  ACTION_EMPLOYEE_UPSERT,
  ACTION_VISITOR_REGISTER,
  ACTION_SETTING_SET,
} from "@/db/schema";
import * as schema from "@/db/schema";
import { config } from "@/server/config";
import { ensureMigrated } from "@/db/migrate";

type LeaderDb = ReturnType<typeof drizzle<typeof schema>>;

function snapshot(db: LeaderDb) {
  return {
    employees: db.select().from(employees).all().map((e) => ({
      id: e.id,
      displayName: e.displayName,
      active: e.active,
      deletedAt: e.deletedAt?.toISOString() ?? null,
    })),
    presence: db.select().from(presence).all().map((p) => ({
      subjectId: p.subjectId,
      subjectType: p.subjectType,
      onSite: p.onSite,
    })),
    visitors: db.select().from(visitors).all().map((v) => ({
      id: v.id,
      firstName: v.firstName,
      company: v.company,
    })),
    settings: db
      .select()
      .from(settings)
      .all()
      .filter((s) => s.key !== "admin_pin_hash") // seeded by migration; not event-driven here
      .map((s) => ({ key: s.key, value: s.value })),
  };
}

describe("replication replay convergence", () => {
  // "Follower" DB — separate sqlite file distinct from the leader (the process-wide one).
  let followerSqlite: Database.Database;
  let followerDb: LeaderDb;
  let followerPath: string;

  beforeAll(() => {
    // Seed leader-side DB (ensureMigrated uses the in-process singleton).
    ensureMigrated();

    // Create follower DB as a completely separate SQLite file.
    followerPath = path.join(
      path.dirname(config.dbPath),
      "follower-replay.sqlite",
    );
    for (const ext of ["", "-wal", "-shm"]) {
      const p = followerPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    followerSqlite = new Database(followerPath);
    followerSqlite.pragma("journal_mode = WAL");
    followerSqlite.pragma("foreign_keys = ON");
    followerDb = drizzle(followerSqlite, { schema });
    migrate(followerDb, {
      migrationsFolder: path.resolve(process.cwd(), "src/db/migrations"),
    });
  });

  afterAll(() => {
    try {
      followerSqlite.close();
    } catch {
      /* ignore */
    }
    closeDb();
  });

  it("follower replay of leader events produces identical derived state", () => {
    // --- Act on leader: produce a realistic stream of events ---
    appendEvent({
      action: ACTION_EMPLOYEE_UPSERT,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: { id: "emp-1", displayName: "Alice" },
    });
    appendEvent({
      action: ACTION_EMPLOYEE_UPSERT,
      subjectType: "employee",
      subjectId: "emp-2",
      payload: { id: "emp-2", displayName: "Bob" },
    });
    appendEvent({
      action: ACTION_SIGN_IN,
      subjectType: "employee",
      subjectId: "emp-1",
      payload: {},
    });
    appendEvent({
      action: ACTION_VISITOR_REGISTER,
      subjectType: "visitor",
      subjectId: "vis-1",
      payload: {
        id: "vis-1",
        firstName: "Vic",
        lastName: "Tor",
        company: "Acme",
        reason: "meeting",
        hostEmployeeId: "emp-1",
        photoPath: "p.jpg",
        signaturePath: "s.png",
      },
    });
    appendEvent({
      action: ACTION_SETTING_SET,
      payload: { key: "kiosk.theme", value: "dark" },
    });

    const leaderEvents = readEventsSince(0);
    expect(leaderEvents.length).toBeGreaterThanOrEqual(5);

    // --- Replay on follower by temporarily swapping the in-process DB ---
    // applyRemoteEvent uses getDb()/getSqlite() internally, so rebind the
    // module's exports for the duration of the replay via vi.spyOn.
    const originalGetDb = dbClient.getDb;
    const getDbSpy = vi
      .spyOn(dbClient, "getDb")
      .mockImplementation(() => followerDb as ReturnType<typeof dbClient.getDb>);
    const getSqliteSpy = vi
      .spyOn(dbClient, "getSqlite")
      .mockImplementation(
        () => followerSqlite as ReturnType<typeof dbClient.getSqlite>,
      );

    try {
      for (const ev of leaderEvents) {
        const applied = applyRemoteEvent(ev);
        expect(applied).toBe(true);
      }
      // Idempotency across replay: re-apply everything, nothing should change.
      for (const ev of leaderEvents) {
        expect(applyRemoteEvent(ev)).toBe(false);
      }
    } finally {
      getDbSpy.mockRestore();
      getSqliteSpy.mockRestore();
    }

    // --- Compare snapshots ---
    const leaderSnap = snapshot(originalGetDb());
    const followerSnap = snapshot(followerDb);
    expect(followerSnap.employees).toEqual(leaderSnap.employees);
    expect(followerSnap.presence).toEqual(leaderSnap.presence);
    expect(followerSnap.visitors).toEqual(leaderSnap.visitors);
    expect(followerSnap.settings).toEqual(leaderSnap.settings);

    // Spot-check: Alice is on site on the follower.
    const alice = followerDb
      .select()
      .from(presence)
      .where(eq(presence.subjectId, "emp-1"))
      .get();
    expect(alice?.onSite).toBe(true);
  });

  it("preserves remote sequence numbers when applying a remote event to a non-empty follower DB", () => {
    const followerPath = path.join(
      path.dirname(config.dbPath),
      "follower-seq-preserve.sqlite",
    );
    for (const ext of ["", "-wal", "-shm"]) {
      const p = followerPath + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const sqlite = new Database(followerPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const follower = drizzle(sqlite, { schema });
    migrate(follower, {
      migrationsFolder: path.resolve(process.cwd(), "src/db/migrations"),
    });

    const existingId = "existing-emp";
    follower.insert(events).values({
      seq: 1,
      id: "existing-1",
      subjectType: "employee",
      subjectId: existingId,
      action: ACTION_EMPLOYEE_UPSERT,
      kioskId: "kiosk-old",
      createdAt: new Date(1),
      payloadJson: JSON.stringify({ id: existingId, displayName: "Old" }),
    }).run();

    const remoteEvent = {
      seq: 101,
      id: "remote-101",
      subjectType: "employee",
      subjectId: "remote-emp",
      action: ACTION_EMPLOYEE_UPSERT,
      kioskId: "kiosk-leader",
      createdAt: new Date(),
      payload: { id: "remote-emp", displayName: "Remote" },
    } as const;

    const getDbSpy = vi
      .spyOn(dbClient, "getDb")
      .mockImplementation(() => follower as ReturnType<typeof dbClient.getDb>);
    const getSqliteSpy = vi
      .spyOn(dbClient, "getSqlite")
      .mockImplementation(
        () => sqlite as ReturnType<typeof dbClient.getSqlite>,
      );

    try {
      expect(applyRemoteEvent(remoteEvent)).toBe(true);
    } finally {
      getDbSpy.mockRestore();
      getSqliteSpy.mockRestore();
    }

    const row = sqlite
      .prepare("SELECT MAX(seq) AS maxSeq, COUNT(*) AS count FROM events")
      .get() as { maxSeq: number; count: number };
    expect(row.maxSeq).toBe(101);
    expect(row.count).toBe(2);

    sqlite.close();
  });
});
