"use client";

import { useEffect, useState } from "react";

interface Vis {
  id: string;
  firstName: string;
  lastName: string;
  company: string;
  reason: string;
  hostEmployeeId: string | null;
  photoPath: string;
  signaturePath: string;
  onSite: boolean;
  createdAt: number;
  deletedAt: number | null;
}

interface Employee {
  id: string;
  displayName: string;
}

export default function VisitorsPage() {
  const [rows, setRows] = useState<Vis[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Vis | null>(null);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editHostId, setEditHostId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = () =>
    fetch("/api/admin/visitors")
      .then((r) => r.json())
      .then((data: Vis[]) => {
        setRows(data);
        // Keep selected in sync after refresh
        if (selected) {
          const updated = data.find((v) => v.id === selected.id);
          setSelected(updated ?? null);
        }
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void refresh();
    fetch("/api/admin/employees")
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectVisitor = (v: Vis) => {
    setSelected(v);
    setEditing(false);
    setSaveError(null);
  };

  const startEdit = () => {
    if (!selected) return;
    setEditFirst(selected.firstName);
    setEditLast(selected.lastName);
    setEditCompany(selected.company);
    setEditReason(selected.reason);
    setEditHostId(selected.hostEmployeeId ?? "");
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/visitors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          firstName: editFirst.trim(),
          lastName: editLast.trim(),
          company: editCompany.trim(),
          reason: editReason.trim(),
          hostEmployeeId: editHostId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed: ${res.status}`);
      }
      setEditing(false);
      await refresh();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const [signingOut, setSigningOut] = useState(false);
  const [resetting, setResetting] = useState(false);

  const toggleOnSite = async (v: Vis) => {
    setSigningOut(true);
    setError(null);
    try {
      const res = await fetch("/api/presence/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType: "visitor",
          subjectId: v.id,
          desired: v.onSite ? "off_site" : "on_site",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed: ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSigningOut(false);
    }
  };

  const resetVisitor = async (v: Vis) => {
    if (
      !confirm(
        `This will sign out ${v.firstName} ${v.lastName} and clear their training record — they will need to complete the full sign-in form including training acknowledgement next visit. Continue?`,
      )
    )
      return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/visitors/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: v.id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed: ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResetting(false);
    }
  };

  const remove = async (v: Vis) => {
    if (!confirm(`Delete visitor ${v.firstName} ${v.lastName}?`)) return;
    const res = await fetch(`/api/admin/visitors?id=${encodeURIComponent(v.id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError(`Delete failed: ${res.status}`);
      return;
    }
    setSelected(null);
    setEditing(false);
    await refresh();
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Visitors</h1>
      {error ? (
        <div className="mb-4 rounded bg-red-900/40 p-2 text-red-200">{error}</div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <table className="w-full text-left">
          <thead className="text-neutral-400">
            <tr>
              <th className="border-b border-neutral-800 px-3 py-2">Name</th>
              <th className="border-b border-neutral-800 px-3 py-2">Company</th>
              <th className="border-b border-neutral-800 px-3 py-2">On site</th>
              <th className="border-b border-neutral-800 px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr
                key={v.id}
                onClick={() => selectVisitor(v)}
                className={`cursor-pointer border-b border-neutral-900 hover:bg-neutral-900 ${selected?.id === v.id ? "bg-neutral-900" : ""}`}
              >
                <td className="px-3 py-2">
                  {v.firstName} {v.lastName}
                </td>
                <td className="px-3 py-2">{v.company}</td>
                <td className="px-3 py-2">{v.onSite ? "yes" : "no"}</td>
                <td className="px-3 py-2 text-sm text-neutral-400">
                  {new Date(v.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                  No visitors registered.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <aside className="rounded-xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
          {selected ? (
            editing ? (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold">Edit visitor</h2>

                {saveError ? (
                  <div className="rounded bg-red-900/40 p-2 text-sm text-red-200">{saveError}</div>
                ) : null}

                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">First name</span>
                  <input
                    value={editFirst}
                    onChange={(e) => setEditFirst(e.target.value)}
                    className="rounded bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">Last name</span>
                  <input
                    value={editLast}
                    onChange={(e) => setEditLast(e.target.value)}
                    className="rounded bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">Company</span>
                  <input
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                    className="rounded bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">Reason for visit</span>
                  <input
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    className="rounded bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700 focus:ring-blue-500"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-400">Host employee</span>
                  <select
                    value={editHostId}
                    onChange={(e) => setEditHostId(e.target.value)}
                    className="rounded bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700 focus:ring-blue-500"
                  >
                    <option value="">— none —</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.displayName}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void saveEdit()}
                    disabled={saving || !editFirst.trim() || !editLast.trim()}
                    className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded-lg bg-neutral-700 px-3 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <h2 className="text-xl font-semibold">
                  {selected.firstName} {selected.lastName}
                </h2>
                <p className="text-sm text-neutral-400">
                  {selected.company} — {selected.reason}
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${selected.id}/photo`}
                  alt="portrait"
                  className="rounded-lg ring-1 ring-neutral-700"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/media/${selected.id}/signature`}
                  alt="signature"
                  className="rounded-lg bg-white ring-1 ring-neutral-700"
                />
                <button
                  type="button"
                  onClick={startEdit}
                  className="w-full rounded-lg bg-neutral-700 px-3 py-2 text-sm"
                >
                  Edit info
                </button>
                <button
                  type="button"
                  onClick={() => void resetVisitor(selected)}
                  disabled={resetting}
                  className="w-full rounded-lg bg-orange-700 px-3 py-2 text-sm disabled:opacity-50"
                >
                  {resetting ? "Resetting…" : "Sign out & require re-training"}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleOnSite(selected)}
                  disabled={signingOut}
                  className={`w-full rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${selected.onSite ? "bg-amber-700" : "bg-emerald-700"}`}
                >
                  {signingOut
                    ? "Updating…"
                    : selected.onSite
                      ? "Sign out (mark off-site)"
                      : "Sign in (mark on-site)"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(selected)}
                  className="w-full rounded-lg bg-red-700 px-3 py-2 text-sm"
                >
                  Delete visitor
                </button>
              </div>
            )
          ) : (
            <p className="text-neutral-500">Select a row to view details.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

