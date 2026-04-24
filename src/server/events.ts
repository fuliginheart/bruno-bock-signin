/**
 * The single write path for the application.
 *
 * Every state mutation flows through `appendEvent`, which:
 *   1. Inserts an event row (append-only audit log).
 *   2. Applies the event's effect to derived tables (presence, employees, visitors, settings).
 *
 * Followers receive replicated events from the leader and feed them through
 * `applyRemoteEvent`, which is idempotent (deduplicated by event ULID).
 */
import { eq, and, gt, lt } from "drizzle-orm";
import { ulid } from "ulid";
import { getDb, getSqlite } from "@/db/client";
import {
  events,
  presence,
  employees,
  visitors,
  settings,
  ACTION_SIGN_IN,
  ACTION_SIGN_OUT,
  ACTION_VISITOR_REGISTER,
  ACTION_EMPLOYEE_UPSERT,
  ACTION_EMPLOYEE_DELETE,
  ACTION_VISITOR_UPDATE,
  ACTION_VISITOR_DELETE,
  ACTION_SETTING_SET,
  type EventAction,
  type SubjectType,
} from "@/db/schema";
import { config } from "./config";

export interface EventInput {
  action: EventAction;
  subjectType?: SubjectType | null;
  subjectId?: string | null;
  payload: Record<string, unknown>;
}

export interface StoredEvent {
  seq: number;
  id: string;
  subjectType: SubjectType | null;
  subjectId: string | null;
  action: EventAction;
  kioskId: string;
  createdAt: Date;
  payload: Record<string, unknown>;
}

type EventListener = (event: StoredEvent) => void;

// Pin the listener set on globalThis so the SSE route handler (Next bundle)
// and the leader-hub (server.ts bundle) share the same subscriber list,
// even when modules are loaded twice in dev mode.
const LISTENERS_KEY = Symbol.for("bb.events.listeners.v1");
type GlobalWithListeners = typeof globalThis & {
  [LISTENERS_KEY]?: Set<EventListener>;
};
const gListeners = globalThis as GlobalWithListeners;
if (!gListeners[LISTENERS_KEY]) {
  gListeners[LISTENERS_KEY] = new Set<EventListener>();
}
const listeners = gListeners[LISTENERS_KEY]!;

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(event: StoredEvent) {
  for (const l of listeners) {
    try {
      l(event);
    } catch (err) {
      // Listener errors must not break the write path.
      console.error("event listener error", err);
    }
  }
}

/**
 * Apply an event's side-effects to derived tables.
 * Pure: takes a sqlite handle so it can run inside a transaction.
 */
function applyEffect(
  sqlite: ReturnType<typeof getSqlite>,
  ev: StoredEvent,
): void {
  const db = getDb();
  switch (ev.action) {
    case ACTION_SIGN_IN:
    case ACTION_SIGN_OUT: {
      if (!ev.subjectType || !ev.subjectId) return;
      const onSite = ev.action === ACTION_SIGN_IN;
      // Upsert presence row — last-write-wins by event timestamp so
      // replicated events converge regardless of arrival order.
      db.insert(presence)
        .values({
          subjectType: ev.subjectType,
          subjectId: ev.subjectId,
          onSite,
          since: ev.createdAt,
          lastKioskId: ev.kioskId,
        })
        .onConflictDoUpdate({
          target: [presence.subjectType, presence.subjectId],
          set: {
            onSite,
            since: ev.createdAt,
            lastKioskId: ev.kioskId,
          },
          setWhere: lt(presence.since, ev.createdAt),
        })
        .run();
      break;
    }
    case ACTION_EMPLOYEE_UPSERT: {
      const p = ev.payload as {
        id: string;
        displayName: string;
        active?: boolean;
      };
      db.insert(employees)
        .values({
          id: p.id,
          displayName: p.displayName,
          active: p.active ?? true,
          createdAt: ev.createdAt,
          updatedAt: ev.createdAt,
        })
        .onConflictDoUpdate({
          target: employees.id,
          set: {
            displayName: p.displayName,
            active: p.active ?? true,
            updatedAt: ev.createdAt,
            deletedAt: null,
          },
        })
        .run();
      break;
    }
    case ACTION_EMPLOYEE_DELETE: {
      const p = ev.payload as { id: string };
      db.update(employees)
        .set({ deletedAt: ev.createdAt, active: false, updatedAt: ev.createdAt })
        .where(eq(employees.id, p.id))
        .run();
      break;
    }
    case ACTION_VISITOR_REGISTER: {
      const p = ev.payload as {
        id: string;
        firstName: string;
        lastName: string;
        company: string;
        reason: string;
        hostEmployeeId: string | null;
        photoPath: string;
        signaturePath: string;
        trainingConfirmedAt?: number | null;
      };
      db.insert(visitors)
        .values({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          company: p.company,
          reason: p.reason,
          hostEmployeeId: p.hostEmployeeId,
          photoPath: p.photoPath,
          signaturePath: p.signaturePath,
          trainingConfirmedAt: p.trainingConfirmedAt
            ? new Date(p.trainingConfirmedAt)
            : ev.createdAt,
          createdAt: ev.createdAt,
          updatedAt: ev.createdAt,
        })
        .onConflictDoNothing()
        .run();
      // Initial sign-in is a separate event emitted alongside register.
      break;
    }
    case ACTION_VISITOR_UPDATE: {
      const p = ev.payload as {
        id: string;
        firstName?: string;
        lastName?: string;
        company?: string;
        reason?: string;
        hostEmployeeId?: string | null;
        photoPath?: string;
        signaturePath?: string;
        trainingConfirmedAt?: number | null;
      };
      const set: Record<string, unknown> = { updatedAt: ev.createdAt };
      if (p.firstName !== undefined) set.firstName = p.firstName;
      if (p.lastName !== undefined) set.lastName = p.lastName;
      if (p.company !== undefined) set.company = p.company;
      if (p.reason !== undefined) set.reason = p.reason;
      if (p.hostEmployeeId !== undefined) set.hostEmployeeId = p.hostEmployeeId;
      if (p.photoPath !== undefined) set.photoPath = p.photoPath;
      if (p.signaturePath !== undefined) set.signaturePath = p.signaturePath;
      if (p.trainingConfirmedAt !== undefined)
        set.trainingConfirmedAt = p.trainingConfirmedAt
          ? new Date(p.trainingConfirmedAt)
          : null;
      db.update(visitors).set(set).where(eq(visitors.id, p.id)).run();
      break;
    }
    case ACTION_VISITOR_DELETE: {
      const p = ev.payload as { id: string };
      db.update(visitors)
        .set({ deletedAt: ev.createdAt, updatedAt: ev.createdAt })
        .where(eq(visitors.id, p.id))
        .run();
      break;
    }
    case ACTION_SETTING_SET: {
      const p = ev.payload as { key: string; value: string };
      db.insert(settings)
        .values({ key: p.key, value: p.value, updatedAt: ev.createdAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: p.value, updatedAt: ev.createdAt },
        })
        .run();
      break;
    }
  }
}

/**
 * Append a locally-generated event. Used by the leader (or by any kiosk in
 * standalone mode). Followers should NOT call this directly for client
 * actions — they should proxy to the leader. They do use it indirectly via
 * `applyRemoteEvent` for replication.
 */
export function appendEvent(input: EventInput): StoredEvent {
  const db = getDb();
  const sqlite = getSqlite();
  const id = ulid();
  const createdAt = new Date();

  const stored: StoredEvent = {
    seq: 0, // filled in by the insert
    id,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    action: input.action,
    kioskId: config.kioskId,
    createdAt,
    payload: input.payload,
  };

  const txn = sqlite.transaction(() => {
    const row = db
      .insert(events)
      .values({
        id: stored.id,
        subjectType: stored.subjectType ?? undefined,
        subjectId: stored.subjectId ?? undefined,
        action: stored.action,
        kioskId: stored.kioskId,
        createdAt: stored.createdAt,
        payloadJson: JSON.stringify(stored.payload),
      })
      .returning({ seq: events.seq })
      .get();
    stored.seq = row!.seq;
    applyEffect(sqlite, stored);
  });
  txn();

  notify(stored);
  return stored;
}

/**
 * Apply an event received from the leader. Idempotent by event ULID — if the
 * same event arrives twice, the second application is a no-op.
 */
export function applyRemoteEvent(remote: StoredEvent): boolean {
  const db = getDb();
  const sqlite = getSqlite();

  let applied = false;
  const txn = sqlite.transaction(() => {
    const existing = db
      .select({ seq: events.seq })
      .from(events)
      .where(eq(events.id, remote.id))
      .get();
    if (existing) return; // already applied
    try {
      db.insert(events)
        .values({
          seq: remote.seq,
          id: remote.id,
          subjectType: remote.subjectType ?? undefined,
          subjectId: remote.subjectId ?? undefined,
          action: remote.action,
          kioskId: remote.kioskId,
          createdAt: remote.createdAt,
          payloadJson: JSON.stringify(remote.payload),
        })
        .run();
    } catch (err) {
      // If the remote leader's seq collides with a local event, the local
      // event history is no longer authoritative. Replace the conflicting row
      // and rebuild derived tables from the reconciled event log.
      const message = (err as Error).message;
      if (!message.includes("UNIQUE constraint failed: events.seq")) {
        throw err;
      }
      const conflict = db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.seq, remote.seq))
        .get();
      if (!conflict || conflict.id === remote.id) {
        throw err;
      }
      db.delete(events).where(eq(events.seq, remote.seq)).run();
      db.insert(events)
        .values({
          seq: remote.seq,
          id: remote.id,
          subjectType: remote.subjectType ?? undefined,
          subjectId: remote.subjectId ?? undefined,
          action: remote.action,
          kioskId: remote.kioskId,
          createdAt: remote.createdAt,
          payloadJson: JSON.stringify(remote.payload),
        })
        .run();
      rebuildDerivedState(sqlite, db);
      applied = true;
      return;
    }

    applyEffect(sqlite, remote);
    applied = true;
  });
  txn();

  if (applied) notify(remote);
  return applied;
}

function rebuildDerivedState(
  sqlite: ReturnType<typeof getSqlite>,
  db: ReturnType<typeof getDb>,
) {
  sqlite.prepare("DELETE FROM presence").run();
  sqlite.prepare("DELETE FROM employees").run();
  sqlite.prepare("DELETE FROM visitors").run();
  sqlite.prepare("DELETE FROM settings WHERE key != 'admin_pin_hash'").run();

  const rows = db.select().from(events).orderBy(events.seq).all();
  for (const r of rows) {
    applyEffect(sqlite, {
      seq: r.seq,
      id: r.id,
      subjectType: r.subjectType ?? null,
      subjectId: r.subjectId ?? null,
      action: r.action,
      kioskId: r.kioskId,
      createdAt: r.createdAt,
      payload: JSON.parse(r.payloadJson),
    });
  }
}

/**
 * Read events strictly newer than `afterSeq`. Used by followers to catch up.
 */
export function readEventsSince(afterSeq: number, limit = 1000): StoredEvent[] {
  const db = getDb();
  const rows = db
    .select()
    .from(events)
    .where(gt(events.seq, afterSeq))
    .orderBy(events.seq)
    .limit(limit)
    .all();
  return rows.map((r) => ({
    seq: r.seq,
    id: r.id,
    subjectType: r.subjectType ?? null,
    subjectId: r.subjectId ?? null,
    action: r.action,
    kioskId: r.kioskId,
    createdAt: r.createdAt,
    payload: JSON.parse(r.payloadJson),
  }));
}

export function getMaxSeq(): number {
  const db = getDb();
  const row = db
    .select({ seq: events.seq })
    .from(events)
    .orderBy(events.seq)
    .limit(1)
    .all()
    .at(-1);
  // Simpler: use a raw query
  const sqlite = getSqlite();
  const r = sqlite
    .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events")
    .get() as { seq: number };
  return r.seq;
}

/* Suppress unused warnings for imports kept for readability */
void and;
void presence;
