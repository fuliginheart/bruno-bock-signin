"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const HOLD_MS = 3000;

export default function AdminGate() {
  const router = useRouter();
  const [showPad, setShowPad] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onCornerDown = () => {
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      setShowPad(true);
    }, HOLD_MS);
  };
  const onCornerUp = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };

  const press = (d: string) => {
    setPin((p) => (p.length < 12 ? p + d : p));
    setError(null);
  };
  const back = () => setPin((p) => p.slice(0, -1));
  const submit = async () => {
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setShowPad(false);
      setPin("");
      router.push("/admin");
    } catch (err) {
      setError((err as Error).message);
      setPin("");
    }
  };

  return (
    <>
      {/* Hidden long-press target in the top-right corner. */}
      <button
        type="button"
        aria-label="Open admin"
        onPointerDown={onCornerDown}
        onPointerUp={onCornerUp}
        onPointerLeave={onCornerUp}
        onPointerCancel={onCornerUp}
        className="fixed right-0 top-0 z-40 h-16 w-16 cursor-default opacity-0"
      />

      {showPad ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
          <div className="w-full max-w-xs rounded-2xl bg-neutral-900 p-6 ring-1 ring-neutral-700">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Admin PIN</h2>
              <button
                type="button"
                onClick={() => {
                  setShowPad(false);
                  setPin("");
                  setError(null);
                }}
                className="text-neutral-400"
              >
                ✕
              </button>
            </div>
            <div className="mb-3 h-12 rounded-xl bg-neutral-800 px-4 text-center font-mono text-3xl leading-[3rem] tracking-widest">
              {"•".repeat(pin.length)}
            </div>
            {error ? (
              <p className="mb-2 text-center text-sm text-red-400">{error}</p>
            ) : null}
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => press(d)}
                  className="h-14 rounded-xl bg-neutral-800 text-2xl font-semibold active:bg-neutral-700"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={back}
                className="h-14 rounded-xl bg-neutral-800 text-lg active:bg-neutral-700"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={() => press("0")}
                className="h-14 rounded-xl bg-neutral-800 text-2xl font-semibold active:bg-neutral-700"
              >
                0
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pin.length < 4}
                className="h-14 rounded-xl bg-blue-600 text-lg font-semibold disabled:opacity-40"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
