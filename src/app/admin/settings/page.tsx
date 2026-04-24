"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// SoundUploader — handles one sign-in or sign-out sound setting
// ---------------------------------------------------------------------------
function SoundUploader({
  label,
  settingKey,
  initialUrl,
}: {
  label: string;
  settingKey: "sound_sign_in" | "sound_sign_out";
  initialUrl: string | null;
}) {
  const [currentUrl, setCurrentUrl] = useState<string | null>(initialUrl);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("key", settingKey);
      fd.append("file", file);
      const res = await fetch("/api/admin/sounds", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setCurrentUrl(j.url as string);
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setRemoving(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/admin/sounds?key=${encodeURIComponent(settingKey)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setCurrentUrl(null);
      setMsg({ ok: true, text: "Removed." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setRemoving(false);
    }
  };

  const preview = () => {
    if (!currentUrl) return;
    new Audio(currentUrl).play().catch(() => {});
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="mb-1 text-lg font-semibold">{label}</h2>

      {currentUrl ? (
        <div className="mb-4 flex items-center gap-3">
          <span className="flex-1 truncate rounded bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
            {currentUrl.split("/").pop()?.split("?")[0]}
          </span>
          <button
            type="button"
            onClick={preview}
            className="rounded bg-neutral-700 px-3 py-1 text-sm"
          >
            ▶ Preview
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={removing}
            className="rounded bg-red-700 px-3 py-1 text-sm disabled:opacity-50"
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : (
        <p className="mb-4 text-sm text-neutral-500">No sound configured — silent.</p>
      )}

      <label className="flex items-center gap-3">
        <span className="text-sm text-neutral-400">Upload new sound</span>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/aac,.mp3,.wav,.ogg,.webm,.aac,.m4a"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
          className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-300 file:mr-3 file:rounded file:bg-blue-600 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-white disabled:opacity-50"
        />
        {uploading ? (
          <span className="text-sm text-neutral-400">Uploading…</span>
        ) : null}
      </label>

      {msg ? (
        <p className={`mt-3 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  const [days, setDays] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [soundSignIn, setSoundSignIn] = useState<string | null>(null);
  const [soundSignOut, setSoundSignOut] = useState<string | null>(null);
  const [soundsLoaded, setSoundsLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((rows: { key: string; value: string }[]) => {
        const row = rows.find((r) => r.key === "training_expiry_days");
        if (row) setDays(Number(row.value) || 365);
        else setDays(365);
        const si = rows.find((r) => r.key === "sound_sign_in");
        const so = rows.find((r) => r.key === "sound_sign_out");
        setSoundSignIn(si?.value || null);
        setSoundSignOut(so?.value || null);
        setSoundsLoaded(true);
      })
      .catch(() => {
        setDays(365);
        setSoundsLoaded(true);
      });
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

      <div className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Notification sounds</h2>
        <p className="text-sm text-neutral-400">
          Audio files played on the roster screen when someone signs in or out.
          Supported formats: mp3, wav, ogg, webm, aac.
        </p>

        {soundsLoaded ? (
          <>
            <SoundUploader
              label="Sign-in sound"
              settingKey="sound_sign_in"
              initialUrl={soundSignIn}
            />
            <SoundUploader
              label="Sign-out sound"
              settingKey="sound_sign_out"
              initialUrl={soundSignOut}
            />
          </>
        ) : (
          <p className="text-sm text-neutral-500">Loading…</p>
        )}
      </div>
    </div>
  );
}
