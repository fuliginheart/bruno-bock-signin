"use client";

import { useEffect, useState } from "react";

interface MusterRow {
  kind: "employee" | "visitor";
  id: string;
  displayName: string;
  company?: string | null;
  since: number | null;
}

export default function MusterPage() {
  const [rows, setRows] = useState<MusterRow[]>([]);

  useEffect(() => {
    void fetch("/api/admin/muster")
      .then((r) => r.json())
      .then(setRows);
  }, []);

  const onSiteCount = rows.length;

  return (
    <div>
      <header className="mb-4 flex items-center justify-between no-print">
        <h1 className="text-2xl font-bold">Muster — On Site Now</h1>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold"
        >
          Print
        </button>
      </header>
      <p className="mb-4 text-lg">
        <strong>{onSiteCount}</strong> people currently on site —{" "}
        {new Date().toLocaleString()}
      </p>
      <table className="w-full text-left text-lg">
        <thead className="text-neutral-400">
          <tr>
            <th className="border-b border-neutral-800 px-3 py-2">Type</th>
            <th className="border-b border-neutral-800 px-3 py-2">Name</th>
            <th className="border-b border-neutral-800 px-3 py-2">Company</th>
            <th className="border-b border-neutral-800 px-3 py-2">Since</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}-${r.id}`} className="border-b border-neutral-900">
              <td className="px-3 py-2 capitalize">{r.kind}</td>
              <td className="px-3 py-2 font-semibold">{r.displayName}</td>
              <td className="px-3 py-2">{r.company ?? "—"}</td>
              <td className="px-3 py-2">
                {r.since ? new Date(r.since).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                Nobody on site.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
