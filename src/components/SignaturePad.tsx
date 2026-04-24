"use client";

import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";

export interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

export default function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const onChangeRef = useRef(onChange);
  const [empty, setEmpty] = useState(true);

  // Keep the ref current without re-running the canvas effect.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Resize for HiDPI.
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const setSize = () => {
      const pad = padRef.current;
      // Preserve any existing signature before the resize clears the canvas.
      const savedData = pad && !pad.isEmpty() ? pad.toDataURL() : null;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d");
      ctx?.scale(ratio, ratio);
      if (savedData && pad) {
        void pad.fromDataURL(savedData);
      } else {
        pad?.clear();
      }
    };
    setSize();
    const pad = new SignaturePadLib(canvas, {
      penColor: "#0a0a0a",
      backgroundColor: "#fff",
      minWidth: 1.2,
      maxWidth: 3,
    });
    padRef.current = pad;
    pad.addEventListener("endStroke", () => {
      const isEmpty = pad.isEmpty();
      setEmpty(isEmpty);
      onChangeRef.current(isEmpty ? null : pad.toDataURL("image/png"));
    });
    window.addEventListener("resize", setSize);
    return () => {
      window.removeEventListener("resize", setSize);
      pad.off();
    };
  }, []); // empty deps — canvas setup runs once; onChange is accessed via ref

  const clear = () => {
    padRef.current?.clear();
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-white ring-2 ring-neutral-700">
        <canvas
          ref={canvasRef}
          className="block h-56 w-full touch-none"
          style={{ touchAction: "none" }}
        />
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={clear}
          disabled={empty}
          className="rounded-xl bg-neutral-700 px-4 py-2 text-sm disabled:opacity-50"
        >
          Clear signature
        </button>
      </div>
    </div>
  );
}
