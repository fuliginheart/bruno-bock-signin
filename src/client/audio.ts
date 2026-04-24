/**
 * Synthesized audio cues using the Web Audio API. No binary assets required.
 * Each cue is short (<400ms) and uses simple oscillators.
 */
"use client";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Play a tone sequence. Each step: { freq, duration, type }. */
function playTones(
  steps: Array<{ freq: number; duration: number; type?: OscillatorType }>,
  gain = 0.15,
) {
  const ac = getCtx();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();

  let t = ac.currentTime;
  for (const step of steps) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = step.type ?? "sine";
    osc.frequency.setValueAtTime(step.freq, t);
    // Quick attack/release envelope.
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.linearRampToValueAtTime(0, t + step.duration);
    osc.connect(g).connect(ac.destination);
    osc.start(t);
    osc.stop(t + step.duration);
    t += step.duration;
  }
}

/** Rising two-note "in" cue. */
export function playSignIn() {
  playTones([
    { freq: 523.25, duration: 0.12 }, // C5
    { freq: 783.99, duration: 0.18 }, // G5
  ]);
}

/** Falling two-note "out" cue. */
export function playSignOut() {
  playTones([
    { freq: 783.99, duration: 0.12 }, // G5
    { freq: 392.0, duration: 0.18 }, // G4
  ]);
}

/** Low buzz on error. */
export function playError() {
  playTones(
    [
      { freq: 220, duration: 0.12, type: "sawtooth" },
      { freq: 180, duration: 0.18, type: "sawtooth" },
    ],
    0.1,
  );
}

/** Call once on first user interaction to unlock audio in kiosk browsers. */
export function unlockAudio() {
  const ac = getCtx();
  if (ac && ac.state === "suspended") void ac.resume();
}
