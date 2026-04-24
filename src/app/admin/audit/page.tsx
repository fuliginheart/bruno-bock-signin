"use client";

import { useEffect, useState } from "react";

interface AuditEvent {
  seq: number;
  id: string;
  createdAt: string;
  kioskId: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  payloadJson: string;
}

interface Employee {
  id: string;
  displayName: string;
}

interface Visitor {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [subjectType, setSubjectType] = useState("all");
  const [subjectId, setSubjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);

  useEffect(() => {
    fetch("/api/admin/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Employee[]) => setEmployees(d))
      .catch(() => setEmployees([]));
    fetch("/api/admin/visitors", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Visitor[]) => setVisitors(d))
      .catch(() => setVisitors([]));
  }, []);

  // Lookup maps: id → display name
  const employeeMap = Object.fromEntries(employees.map((e) => [e.id, e.displayName]));
  const visitorMap = Object.fromEntries(
    visitors.map((v) => [v.id, `${v.firstName} ${v.lastName}${v.company ? ` (${v.company})` : ""}`]),
  );

  const resolveSubject = (type: string | null, id: string | null): string => {
    if (!type || !id) return "—";
    if (type === "employee") return employeeMap[id] ?? `Employee ${id.slice(0, 8)}…`;
    if (type === "visitor") return visitorMap[id] ?? `Visitor ${id.slice(0, 8)}…`;
    return id;
  };

  const ACTION_LABELS: Record<string, string> = {
    sign_in: "Sign In",
    sign_out: "Sign Out",
    visitor_register: "Visitor Registered",
    visitor_update: "Visitor Updated",
    visitor_delete: "Visitor Deleted",
    employee_upsert: "Employee Saved",
    employee_delete: "Employee Deleted",
    setting_set: "Setting Changed",
  };

  const formatAction = (action: string) => ACTION_LABELS[action] ?? action;

  const formatPayload = (json: string): string => {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      // Show a concise summary of the most useful fields, drop IDs and media paths.
      const skip = new Set(["id", "photoPath", "signaturePath", "photoDataUrl", "signatureDataUrl"]);
      const parts = Object.entries(obj)
        .filter(([k]) => !skip.has(k))
        .map(([k, v]) => {
          const val = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}: ${val.length > 40 ? val.slice(0, 40) + "…" : val}`;
        });
      return parts.join(" · ") || "—";
    } catch {
      return json;
    }
  };

  // Reset subjectId when type changes
  const handleSubjectTypeChange = (v: string) => {
    setSubjectType(v);
    setSubjectId("");
  };

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (subjectType !== "all") params.set("subjectType", subjectType);
      if (subjectId.trim()) params.set("subjectId", subjectId.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const url = `/api/admin/audit?${params.toString()}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`);
      }
      const data = (await res.json()) as AuditEvent[];
      setEvents(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEvents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const exportUrl = () => {
    const params = new URLSearchParams();
    if (subjectType !== "all") params.set("subjectType", subjectType);
    if (subjectId.trim()) params.set("subjectId", subjectId.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const query = params.toString();
    return `/api/admin/audit/export${query ? `?${query}` : ""}`;
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Audit log</h1>
      <p className="mb-6 text-neutral-400">
        Search the in/out event log by employee, visitor, and date range.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-2 text-sm">
          <span className="block text-neutral-400">Subject type</span>
          <select
            className="w-full rounded-lg bg-neutral-800 px-3 py-2 ring-1 ring-neutral-700"
            value={subjectType}
            onChange={(e) => handleSubjectTypeChange(e.target.value)}
          >
            <option value="all">All</option>
            <option value="employee">Employee</option>
            <option value="visitor">Visitor</option>
          </select>
        </label>

        <label className="space-y-2 text-sm">
          <span className="block text-neutral-400">
            {subjectType === "employee"
              ? "Employee"
              : subjectType === "visitor"
                ? "Visitor"
                : "Subject"}
          </span>
          {subjectType === "employee" ? (
            <select
              className="w-full rounded-lg bg-neutral-800 px-3 py-2 ring-1 ring-neutral-700"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">All employees</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.displayName}
                </option>
              ))}
            </select>
          ) : subjectType === "visitor" ? (
            <select
              className="w-full rounded-lg bg-neutral-800 px-3 py-2 ring-1 ring-neutral-700"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">All visitors</option>
              {visitors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.firstName} {v.lastName}{v.company ? ` (${v.company})` : ""}
                </option>
              ))}
            </select>
          ) : (
            <select
              disabled
              className="w-full rounded-lg bg-neutral-800 px-3 py-2 text-neutral-500 ring-1 ring-neutral-700"
            >
              <option>Select a type first</option>
            </select>
          )}
        </label>

        <label className="space-y-2 text-sm">
          <span className="block text-neutral-400">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-lg bg-neutral-800 px-3 py-2 ring-1 ring-neutral-700"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="block text-neutral-400">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-lg bg-neutral-800 px-3 py-2 ring-1 ring-neutral-700"
          />
        </label>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={fetchEvents}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold"
          disabled={loading}
        >
          {loading ? "Searching…" : "Search"}
        </button>
        <a
          href={exportUrl()}
          className="rounded-lg bg-neutral-800 px-4 py-2 font-semibold"
        >
          Export filtered CSV
        </a>
        <span className="text-sm text-neutral-500">Showing {events.length} rows</span>
      </div>

      {error ? (
        <div className="mb-4 rounded bg-red-900/40 p-3 text-red-200">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-neutral-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-neutral-950 text-neutral-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Kiosk</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.seq} className="border-t border-neutral-900">
                <td className="px-3 py-2 text-neutral-500">{event.seq}</td>
                <td className="px-3 py-2 text-neutral-400">
                  {new Date(event.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-medium text-neutral-200">
                  {formatAction(event.action)}
                </td>
                <td className="px-3 py-2 text-neutral-200">
                  {resolveSubject(event.subjectType, event.subjectId)}
                </td>
                <td className="px-3 py-2 text-neutral-400">{event.kioskId}</td>
                <td className="px-3 py-2 text-neutral-400 break-words max-w-[340px]">
                  {formatPayload(event.payloadJson)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
