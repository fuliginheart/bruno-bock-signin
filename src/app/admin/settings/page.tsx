"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [days, setDays] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((rows: { key: string; value: string }[]) => {
        const row = rows.find((r) => r.key === "training_expiry_days");
        if (row) setDays(Number(row.value) || 365);
        else setDays(365);
      })
      .catch(() => setDays(365));
  }, []);

  const save = async () => {
    if (days === "" || Number(days) < 1) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "training_expiry_days", value: String(days) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-1 text-lg font-semibold">Safety training expiry</h2>
        <p className="mb-4 text-sm text-neutral-400">
          Returning visitors who have a valid training signature within this
          window will skip the training step on sign-in.
        </p>

        <label className="flex flex-col gap-2">
          <span className="text-sm text-neutral-400">Expiry (days)</span>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={9999}
              value={days}
              onChange={(e) =>
                setDays(e.target.value === "" ? "" : Number(e.target.value))
              }
              className="w-32 rounded-lg bg-neutral-800 px-3 py-2 text-lg ring-1 ring-neutral-700 focus:outline-none focus:ring-neutral-500"
            />
            <button
              type="button"
              onClick={save}
              disabled={saving || days === "" || Number(days) < 1}
              className="rounded-lg bg-blue-600 px-4 py-2 font-semibold disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </label>

        {message ? (
          <p
            className={`mt-3 text-sm ${message.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {message.text}
          </p>
        ) : null}
      </section>
    </div>
  );
}
