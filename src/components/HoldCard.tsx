"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playError, unlockAudio } from "@/client/audio";

const HOLD_MS = 1000;

export interface HoldCardProps {
  subjectType: "employee" | "visitor";
  subjectId: string;
  displayName: string;
  subtitle?: string | null;
  photoSrc?: string | null;
  onSite: boolean;
  since?: number | null;
  small?: boolean;
  /** Called optimistically on hold completion. */
  onToggle: (next: boolean) => Promise<void>;
}

function formatSince(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`
  );
}

export default function HoldCard(props: HoldCardProps) {
  const {
    subjectType,
    subjectId,
    displayName,
    subtitle,
    photoSrc,
    onSite,
    since,
    small,
    onToggle,
  } = props;

  const [progress, setProgress] = useState(0); // 0..1
  const [busy, setBusy] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    setProgress(0);
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const tick = useCallback(
    (ts: number) => {
      if (startRef.current == null) return;
      const elapsed = ts - startRef.current;
      const p = Math.min(1, elapsed / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        // Completed.
        rafRef.current = null;
        startRef.current = null;
        const next = !onSite;
        setBusy(true);
        onToggle(next)
          .catch(() => {
            playError();
          })
          .finally(() => {
            setBusy(false);
            setProgress(0);
          });
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [onSite, onToggle],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (busy) return;
      unlockAudio();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      startRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    },
    [busy, tick],
  );

  // Animate fill direction.
  //   on-site  -> off-site:  fill drains right -> left (signout color)
  //   off-site -> on-site:  fill grows left -> right (signin color)
  const fillStyle: React.CSSProperties = onSite
    ? {
        // draining: width = (1 - progress) * 100%, anchored right
        right: 0,
        width: `${(1 - progress) * 100}%`,
      }
    : {
        // filling: width grows from left
        left: 0,
        width: `${progress * 100}%`,
      };

  const fillColor = onSite ? "bg-slate-950/70" : "bg-sky-500/30";
  const baseColor = onSite
    ? "bg-sky-600 text-white shadow-[0_18px_40px_-24px_rgba(59,130,246,0.9)]"
    : "bg-neutral-900 text-slate-100";
  const ring = onSite ? "ring-sky-400" : "ring-neutral-700";

  return (
    <button
      data-subject-type={subjectType}
      data-subject-id={subjectId}
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      disabled={busy}
      className={`relative flex ${subtitle ? "h-44" : since ? "h-28" : "h-20"} select-none items-center justify-center overflow-hidden rounded-3xl text-center ${small ? "text-xl" : "text-2xl"} font-semibold ring-2 transition duration-150 ease-out ${baseColor} ${ring} disabled:cursor-wait disabled:opacity-50 active:scale-[0.98]`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute top-0 bottom-0 transition-all duration-75 ${fillColor}`}
        style={fillStyle}
      />
      <div className="relative z-10 flex w-full flex-col items-center px-3">
        {subtitle ? (
          <>
            <span className="leading-tight">{displayName}</span>
            <span className="mt-1 text-sm font-normal text-white/70">
              {subtitle}
            </span>
            {photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoSrc}
                alt=""
                className="mt-2 h-16 w-16 rounded-full object-cover ring-2 ring-white/40"
                draggable={false}
              />
            ) : null}
          </>
        ) : (
          <>
            {photoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoSrc}
                alt=""
                className="mb-2 h-16 w-16 rounded-full object-cover ring-2 ring-white/40"
                draggable={false}
              />
            ) : null}
            <span className="leading-tight">{displayName}</span>
          </>
        )}
        {since != null ? (
          <span className="mt-1 text-xs font-normal opacity-60">
            {onSite ? "In" : "Out"} {formatSince(since)}
          </span>
        ) : null}
      </div>
    </button>
  );
}
