import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * Subject types: who can be on-site.
 */
export const SUBJECT_EMPLOYEE = "employee" as const;
export const SUBJECT_VISITOR = "visitor" as const;
export type SubjectType = typeof SUBJECT_EMPLOYEE | typeof SUBJECT_VISITOR;

/**
 * Event actions written to the append-only log.
 * The log doubles as the replication stream.
 */
export const ACTION_SIGN_IN = "sign_in" as const;
export const ACTION_SIGN_OUT = "sign_out" as const;
export const ACTION_VISITOR_REGISTER = "visitor_register" as const;
export const ACTION_EMPLOYEE_UPSERT = "employee_upsert" as const;
export const ACTION_EMPLOYEE_DELETE = "employee_delete" as const;
export const ACTION_VISITOR_UPDATE = "visitor_update" as const;
export const ACTION_VISITOR_DELETE = "visitor_delete" as const;
export const ACTION_SETTING_SET = "setting_set" as const;

export type EventAction =
  | typeof ACTION_SIGN_IN
  | typeof ACTION_SIGN_OUT
  | typeof ACTION_VISITOR_REGISTER
  | typeof ACTION_EMPLOYEE_UPSERT
  | typeof ACTION_EMPLOYEE_DELETE
  | typeof ACTION_VISITOR_UPDATE
  | typeof ACTION_VISITOR_DELETE
  | typeof ACTION_SETTING_SET;

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(), // ULID
  displayName: text("display_name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const visitors = sqliteTable("visitors", {
  id: text("id").primaryKey(), // ULID
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  company: text("company").notNull(),
  reason: text("reason").notNull(),
  hostEmployeeId: text("host_employee_id").references(() => employees.id),
  photoPath: text("photo_path").notNull(),
  signaturePath: text("signature_path").notNull(),
  trainingConfirmedAt: integer("training_confirmed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const presence = sqliteTable(
  "presence",
  {
    subjectType: text("subject_type").notNull().$type<SubjectType>(),
    subjectId: text("subject_id").notNull(),
    onSite: integer("on_site", { mode: "boolean" }).notNull().default(false),
    since: integer("since", { mode: "timestamp_ms" }).notNull(),
    lastKioskId: text("last_kiosk_id").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subjectType, t.subjectId] }),
    onSiteIdx: index("presence_on_site_idx").on(t.onSite),
  }),
);

/**
 * Append-only event log.
 * `seq` is a monotonic per-leader sequence used for replication catch-up.
 * `id` is a ULID — globally unique, used for idempotent application on followers.
 */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(), // ULID
    subjectType: text("subject_type").$type<SubjectType>(),
    subjectId: text("subject_id"),
    action: text("action").notNull().$type<EventAction>(),
    kioskId: text("kiosk_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (t) => ({
    createdAtIdx: index("events_created_at_idx").on(t.createdAt),
    subjectIdx: index("events_subject_idx").on(t.subjectType, t.subjectId),
  }),
);

export const kiosks = sqliteTable("kiosks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lastSeen: integer("last_seen", { mode: "timestamp_ms" }).notNull(),
  role: text("role").notNull().default("follower"), // 'leader' | 'follower'
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
