"use client";

import { useEffect, useState } from "react";

interface Emp {
  id: string;
  displayName: string;
  active: boolean;
  deletedAt: number | null;
}

export default function EmployeesPage() {
  const [emps, setEmps] = useState<Emp[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Inline edit state: key = employee id
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = () =>
    fetch("/api/admin/employees")
      .then((r) => r.json())
      .then(setEmps)
      .catch((e: Error) => setError(e.message));

  const importCsv = async () => {
    if (!selectedFile) return;
    setError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const res = await fetch("/api/admin/employees/import", {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `Import failed: ${res.status}`);
      } else {
        setImportResult(
          `Imported ${body.created ?? 0} new, updated ${body.updated ?? 0} employee(s).`,
        );
        setSelectedFile(null);
        await refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    const res = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim() }),
    });
    if (!res.ok) {
      setError(`Add failed: ${res.status}`);
      return;
    }
    setName("");
    await refresh();
  };

  const startEdit = (e: Emp) => {
    setEditingId(e.id);
    setEditName(e.displayName);
    setEditActive(e.active);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, displayName: editName.trim(), active: editActive }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed: ${res.status}`);
      }
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this employee?")) return;
    setError(null);
    const res = await fetch(`/api/admin/employees?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError(`Delete failed: ${res.status}`);
      return;
    }
    if (editingId === id) setEditingId(null);
    await refresh();
  };

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Employees</h1>

      <div className="mb-6 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            placeholder="Employee name"
            className="flex-1 rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700"
          />
          <button
            type="button"
            onClick={add}
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold disabled:opacity-50"
            disabled={!name.trim()}
          >
            Add
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/admin/employees/export"
            className="rounded-lg bg-blue-600 px-4 py-2 font-semibold"
          >
            Download CSV
          </a>
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-neutral-800 px-4 py-2 text-sm ring-1 ring-neutral-700">
            <span>{selectedFile ? selectedFile.name : "Select CSV"}</span>
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(event) => {
                setSelectedFile(event.target.files?.[0] ?? null);
                setImportResult(null);
              }}
            />
          </label>
          <button
            type="button"
            onClick={importCsv}
            disabled={!selectedFile || importing}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import CSV"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded bg-red-900/40 p-2 text-red-200">{error}</div>
      ) : null}

      {importResult ? (
        <div className="mb-4 rounded bg-emerald-900/40 p-2 text-emerald-100">
          {importResult}
        </div>
      ) : null}

      <table className="w-full text-left">
        <thead className="text-neutral-400">
          <tr>
            <th className="border-b border-neutral-800 px-3 py-2">Name</th>
            <th className="border-b border-neutral-800 px-3 py-2">Status</th>
            <th className="border-b border-neutral-800 px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {emps.map((e) =>
            editingId === e.id ? (
              <tr key={e.id} className="border-b border-neutral-900 bg-neutral-900/60">
                <td className="px-3 py-2">
                  <input
                    value={editName}
                    onChange={(ev) => setEditName(ev.target.value)}
                    onKeyDown={(ev) => { if (ev.key === "Enter") void saveEdit(e.id); if (ev.key === "Escape") cancelEdit(); }}
                    autoFocus
                    className="w-full rounded bg-neutral-800 px-2 py-1 outline-none ring-1 ring-blue-500"
                  />
                </td>
                <td className="px-3 py-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editActive}
                      onChange={(ev) => setEditActive(ev.target.checked)}
                      className="accent-blue-500"
                    />
                    Active
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void saveEdit(e.id)}
                      disabled={saving || !editName.trim()}
                      className="rounded bg-blue-600 px-3 py-1 text-sm disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded bg-neutral-700 px-3 py-1 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={e.id} className="border-b border-neutral-900">
                <td className="px-3 py-2">{e.displayName}</td>
                <td className="px-3 py-2 text-sm text-neutral-400">
                  {e.deletedAt ? "deleted" : e.active ? "active" : "inactive"}
                </td>
                <td className="px-3 py-2 text-right">
                  {e.deletedAt ? null : (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(e)}
                        className="rounded bg-neutral-700 px-3 py-1 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(e.id)}
                        className="rounded bg-red-700 px-3 py-1 text-sm"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ),
          )}
          {emps.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-neutral-500">
                No employees yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
