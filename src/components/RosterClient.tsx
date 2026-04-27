"use client";

import { useEffect, useState } from "react";
import HoldCard from "@/components/HoldCard";
import { useRoster, type RosterItem } from "@/client/roster-store";

async function fetchRoster() {
  const res = await fetch("/api/roster", { cache: "no-store" });
  if (!res.ok) throw new Error("roster fetch failed");
  return (await res.json()) as {
    employees: RosterItem[];
    visitors: RosterItem[];
  };
}

async function postToggle(item: RosterItem, next: boolean) {
  const res = await fetch("/api/presence/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subjectType: item.subjectType,
      subjectId: item.id,
      desired: next ? "on_site" : "off_site",
    }),
  });
  if (!res.ok) throw new Error(`toggle failed: ${res.status}`);
}

export default function RosterClient() {
  const { employees, visitors, ready, setRoster, applyEvent, setOptimistic } =
    useRoster();
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  async function loadRoster() {
    const roster = await fetchRoster();
    setRoster(roster.employees, roster.visitors);
    setError(null);
    return roster;
  }

  // Initial load.
  useEffect(() => {
    loadRoster().catch((e) => setError(e.message));
  }, [setRoster]);

  // Live updates over SSE.
  useEffect(() => {
    const es = new EventSource("/api/stream");
    let opened = false;
    es.onopen = () => {
      setConnected(true);
      if (opened) {
        // SSE reconnected after a drop — re-fetch to sync any missed state.
        loadRoster().catch(() => {});
      }
      opened = true;
    };
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === "event") {
          applyEvent({
            action: data.event.action,
            subjectType: data.event.subjectType,
            subjectId: data.event.subjectId,
            createdAt: data.event.createdAt,
            payload: data.event.payload,
          });
          // If a visitor was just registered, refresh roster to pick them up.
          if (data.event.action === "visitor_register") {
            loadRoster().catch(() => {});
          }
          // Play notification sounds on sign-in / sign-out.
          if (data.event.action === "sign_in") {
            new Audio("/sounds/sign-in.mp3").play().catch(() => {});
          }
          if (data.event.action === "sign_out") {
            new Audio("/sounds/sign-out.mp3").play().catch(() => {});
          }
        }
      } catch {}
    };
    es.onerror = () => {
      setConnected(false);
      // Browser will auto-reconnect.
    };
    return () => es.close();
  }, [applyEvent, setRoster]);

  const handleToggle = async (item: RosterItem, next: boolean) => {
    setOptimistic(item.subjectType, item.id, next);
    try {
      await postToggle(item, next);
    } catch (err) {
      // Revert.
      setOptimistic(item.subjectType, item.id, !next);
      throw err;
    }
  };

  return (
    <main className="mx-auto max-w-screen-2xl px-6 py-6">
      {!connected ? (
        <div className="mb-4 rounded-lg bg-amber-900/50 px-4 py-2 text-amber-100 ring-1 ring-amber-700">
          Reconnecting to kiosk service… Sign-ins may be delayed.
        </div>
      ) : null}
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Bruno Bock — On-Site Roster</h1>
      </header>

      {error ? (
        <div className="mb-4 rounded-lg bg-red-900/40 p-3 text-red-200">
          {error}
        </div>
      ) : null}

      <section className="mb-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold uppercase tracking-wide text-neutral-400">
            Employees
          </h2>
          <span className="text-sm text-neutral-500">
            {employees.filter((e) => e.onSite).length} on site /{" "}
            {employees.length} total
          </span>
        </div>
        {!ready ? (
          <p className="text-neutral-500">Loading…</p>
        ) : employees.length === 0 ? (
          <p className="text-neutral-500">No employees configured. Use the admin panel to add some.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {employees.map((e) => (
              <HoldCard
                key={e.id}
                subjectType="employee"
                subjectId={e.id}
                displayName={e.displayName}
                onSite={e.onSite}
                onToggle={(next) => handleToggle(e, next)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold uppercase tracking-wide text-neutral-400">
            Visitors on site
          </h2>
          <a
            href="/visitor"
            className="rounded-xl bg-blue-600 px-5 py-3 text-lg font-semibold hover:bg-blue-500"
          >
            + Sign in as Visitor
          </a>
        </div>
        {visitors.length === 0 ? (
          <p className="text-neutral-500">No visitors on site.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {visitors.map((v) => (
              <HoldCard
                key={v.id}
                subjectType="visitor"
                subjectId={v.id}
                displayName={v.displayName}
                subtitle={v.company}
                photoSrc={v.photoPath ? `/api/media/${v.id}/photo` : null}
                onSite={v.onSite}
                onToggle={(next) => handleToggle(v, next)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
