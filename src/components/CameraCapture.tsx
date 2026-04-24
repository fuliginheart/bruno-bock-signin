"use client";

import { useEffect, useRef, useState } from "react";

export interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  width?: number;
  height?: number;
}

export default function CameraCapture({
  onCapture,
  width = 640,
  height = 480,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width, height, facingMode: "user" },
          audio: false,
        });
        if (cancelled || !videoRef.current) return;
        const video = videoRef.current;
        video.srcObject = stream;
        // Wait for the video element to be ready before calling play(),
        // then swallow AbortError which the browser throws when a new load
        // interrupts an in-flight play() (benign race during strict-mode
        // double-invocation or fast navigation).
        await new Promise<void>((resolve) => {
          video.onloadedmetadata = () => resolve();
        });
        if (cancelled) return;
        await video.play().catch((err: unknown) => {
          if ((err as { name?: string }).name !== "AbortError") {
            throw err;
          }
        });
      } catch (err) {
        if (!cancelled) setStreamErr((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [width, height]);

  const snap = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/png");
    setShot(url);
    onCapture(url);
  };

  const startCountdown = () => {
    setShot(null);
    setCountdown(3);
    let n = 3;
    const t = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(t);
        setCountdown(null);
        snap();
      } else {
        setCountdown(n);
      }
    }, 1000);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative overflow-hidden rounded-2xl bg-black ring-2 ring-neutral-700">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt="captured" className="max-h-[60vh]" />
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-[60vh]"
          />
        )}
        {countdown !== null ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-9xl font-bold">
            {countdown}
          </div>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      {streamErr ? (
        <p className="text-red-400">Camera error: {streamErr}</p>
      ) : null}
      <div className="flex gap-3">
        {shot ? (
          <button
            type="button"
            onClick={startCountdown}
            className="rounded-xl bg-neutral-700 px-5 py-3 text-lg"
          >
            Retake
          </button>
        ) : (
          <button
            type="button"
            onClick={startCountdown}
            disabled={!!streamErr}
            className="rounded-xl bg-blue-600 px-5 py-3 text-lg font-semibold disabled:opacity-50"
          >
            Take Photo
          </button>
        )}
      </div>
    </div>
  );
}
