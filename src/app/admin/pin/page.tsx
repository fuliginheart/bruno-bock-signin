"use client";

import { useState } from "react";

export default function PinPage() {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setMsg(null);
    if (pin.length < 4) {
      setMsg({ ok: false, text: "PIN must be at least 4 digits." });
      return;
    }
    if (pin !== confirm) {
      setMsg({ ok: false, text: "PINs do not match." });
      return;
    }
    const res = await fetch("/api/admin/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPin: pin }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: j.error || `HTTP ${res.status}` });
      return;
    }
    setPin("");
    setConfirm("");
    setMsg({ ok: true, text: "PIN updated. New PIN takes effect next login." });
  };

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-2xl font-bold">Change admin PIN</h1>
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm text-neutral-400">New PIN</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            className="mt-1 w-full rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700"
          />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-400">Confirm PIN</span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            className="mt-1 w-full rounded-lg bg-neutral-800 px-3 py-2 outline-none ring-1 ring-neutral-700"
          />
        </label>
        {msg ? (
          <p
            className={msg.ok ? "text-green-400" : "text-red-400"}
            role="status"
          >
            {msg.text}
          </p>
        ) : null}
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold"
        >
          Update PIN
        </button>
      </div>
    </div>
  );
}
