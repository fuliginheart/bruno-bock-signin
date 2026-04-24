/**
 * Read-side queries — pure functions, no mutations. Safe to run on any node.
 */
import { eq, and, isNull, desc, gt, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  employees,
  visitors,
  presence,
  events,
  settings,
  SUBJECT_EMPLOYEE,
  SUBJECT_VISITOR,
  type SubjectType,
} from "@/db/schema";

export interface RosterEntry {
  subjectType: SubjectType;
  id: string;
  displayName: string;
  company?: string | null;
  photoPath?: string | null;
  onSite: boolean;
  since: Date | null;
}

export function listEmployees() {
  const db = getDb();
  return db
    .select()
    .from(employees)
    .where(isNull(employees.deletedAt))
    .all();
}

export function listVisitors(opts?: { onlyOnSite?: boolean }) {
  const db = getDb();
  const rows = db
    .select({
      v: visitors,
      p: presence,
    })
    .from(visitors)
    .leftJoin(
      presence,
      and(
        eq(presence.subjectType, SUBJECT_VISITOR),
        eq(presence.subjectId, visitors.id),
      ),
    )
    .where(isNull(visitors.deletedAt))
    .all();

  return rows
    .map((r) => ({
      ...r.v,
      onSite: r.p?.onSite ?? false,
      since: r.p?.since ?? null,
    }))
    .filter((v) => (opts?.onlyOnSite ? v.onSite : true));
}

export function getRoster(): {
  employees: RosterEntry[];
  visitors: RosterEntry[];
} {
  const db = getDb();
  const empRows = db
    .select({ e: employees, p: presence })
    .from(employees)
    .leftJoin(
      presence,
      and(
        eq(presence.subjectType, SUBJECT_EMPLOYEE),
        eq(presence.subjectId, employees.id),
      ),
    )
    .where(and(isNull(employees.deletedAt), eq(employees.active, true)))
    .all();

  const visRows = db
    .select({ v: visitors, p: presence })
    .from(visitors)
    .leftJoin(
      presence,
      and(
        eq(presence.subjectType, SUBJECT_VISITOR),
        eq(presence.subjectId, visitors.id),
      ),
    )
    .where(isNull(visitors.deletedAt))
    .all();

  const VISITOR_POST_SIGNOUT_DISPLAY_MS = 12 * 60 * 60 * 1000;
  return {
    employees: empRows.map((r) => ({
      subjectType: SUBJECT_EMPLOYEE,
      id: r.e.id,
      displayName: r.e.displayName,
      onSite: r.p?.onSite ?? false,
      since: r.p?.since ?? null,
    })),
    visitors: visRows
      .map((r) => ({
        subjectType: SUBJECT_VISITOR,
        id: r.v.id,
        displayName: `${r.v.firstName} ${r.v.lastName}`.trim(),
        company: r.v.company,
        photoPath: r.v.photoPath,
        onSite: r.p?.onSite ?? false,
        since: r.p?.since ?? null,
      }))
      .filter((v) => {
        if (v.onSite) return true;
        if (!v.since) return false;
        return Date.now() - v.since.getTime() < VISITOR_POST_SIGNOUT_DISPLAY_MS;
      }),
  };
}

export function getMusterList() {
  const roster = getRoster();
  return [
    ...roster.employees
      .filter((e) => e.onSite)
      .map((e) => ({ ...e, kind: "employee" as const })),
    ...roster.visitors.map((v) => ({ ...v, kind: "visitor" as const })),
  ].sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));
}

export function listAuditEvents(opts?: {
  from?: Date;
  to?: Date;
  subjectType?: SubjectType;
  subjectId?: string;
  limit?: number;
}) {
  const db = getDb();
  let q = db
    .select()
    .from(events)
    .orderBy(desc(events.createdAt))
    .$dynamic();

  if (opts?.subjectType) q = q.where(eq(events.subjectType, opts.subjectType));
  if (opts?.subjectId) q = q.where(eq(events.subjectId, opts.subjectId));
  if (opts?.from) q = q.where(gt(events.createdAt, opts.from));
  if (opts?.to) q = q.where(lt(events.createdAt, opts.to));
  if (opts?.limit) q = q.limit(opts.limit);
  return q.all();
}

/**
 * Search visitors by partial first name, last name, or company.
 * Returns the 10 most-recently-created non-deleted matches.
 */
export function searchVisitors(q: string) {
  const db = getDb();
  const like = `%${q.toLowerCase()}%`;
  return db
    .select({
      id: visitors.id,
      firstName: visitors.firstName,
      lastName: visitors.lastName,
      company: visitors.company,
      reason: visitors.reason,
      hostEmployeeId: visitors.hostEmployeeId,
      trainingConfirmedAt: visitors.trainingConfirmedAt,
      createdAt: visitors.createdAt,
    })
    .from(visitors)
    .where(
      and(
        isNull(visitors.deletedAt),
        or(
          sql`LOWER(${visitors.firstName}) LIKE ${like}`,
          sql`LOWER(${visitors.lastName}) LIKE ${like}`,
          sql`LOWER(${visitors.company}) LIKE ${like}`,
        ),
      ),
    )
    .orderBy(desc(visitors.createdAt))
    .limit(10)
    .all();
}

/**
 * Returns the configured training expiry in days (default 365).
 * Reads the 'training_expiry_days' key from the settings table.
 */
export function getTrainingExpiryDays(): number {
  const db = getDb();
  const row = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "training_expiry_days"))
    .get();
  if (!row) return 365;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 365;
}
