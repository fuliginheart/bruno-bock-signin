"use client";

import { useEffect, useState } from "react";

interface KiosksInfo {
  self: { kioskId: string; name: string; role: string; lastSeq: number };
  leader: { id: string | null; url: string | null; lastHeartbeat: number };
  peers: string[];
}

export default function KiosksPage() {
  const [info, setInfo] = useState<KiosksInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    fetch("/api/admin/kiosks")
      .then((r) => r.json())
      .then(setInfo)
      .catch((e) => setError(e.message));

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const promote = async () => {
    if (!confirm("Trigger a re-election? Brief write disruption may occur."))
      return;
    await fetch("/api/admin/kiosks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "promote" }),
    });
    await refresh();
  };

  if (error) return <p className="text-red-400">{error}</p>;
  if (!info) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Kiosks</h1>

      <section className="rounded-xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
        <h2 className="mb-2 text-lg font-semibold">This kiosk</h2>
        <dl className="grid grid-cols-[150px_1fr] gap-2 text-sm">
          <dt className="text-neutral-400">ID</dt>
          <dd>{info.self.kioskId}</dd>
          <dt className="text-neutral-400">Name</dt>
          <dd>{info.self.name}</dd>
          <dt className="text-neutral-400">Role</dt>
          <dd>
            <span
              className={`rounded px-2 py-0.5 text-xs ${info.self.role === "leader" ? "bg-green-700" : "bg-neutral-700"}`}
            >
              {info.self.role}
            </span>
          </dd>
          <dt className="text-neutral-400">Last seq</dt>
          <dd>{info.self.lastSeq}</dd>
        </dl>
      </section>

      <section className="rounded-xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
        <h2 className="mb-2 text-lg font-semibold">Current leader</h2>
        <dl className="grid grid-cols-[150px_1fr] gap-2 text-sm">
          <dt className="text-neutral-400">Leader id</dt>
          <dd>{info.leader.id ?? "(none)"}</dd>
          <dt className="text-neutral-400">URL</dt>
          <dd>{info.leader.url ?? "(self)"}</dd>
          <dt className="text-neutral-400">Last heartbeat</dt>
          <dd>
            {info.leader.lastHeartbeat
              ? new Date(info.leader.lastHeartbeat).toLocaleString()
              : "—"}
          </dd>
        </dl>
        <button
          type="button"
          onClick={promote}
          className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold"
        >
          Trigger re-election
        </button>
      </section>

      <section className="rounded-xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
        <h2 className="mb-2 text-lg font-semibold">Configured peers</h2>
        {info.peers.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No peers configured. This kiosk is operating standalone.
          </p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {info.peers.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
