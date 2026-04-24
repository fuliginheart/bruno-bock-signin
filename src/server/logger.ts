import fs from "node:fs";
import path from "node:path";
import pino, { type Level, type StreamEntry, multistream } from "pino";
import { config } from "./config";

const isDev = process.env.NODE_ENV === "development";

// "silent" is a valid pino level but not in the StreamEntry Level type.
// Treat it as "fatal" for stream filtering (effectively silences all streams
// since nothing emits above fatal).
const streamLevel: Level =
  config.logLevel === "silent" ? "fatal" : (config.logLevel as Level);

function ensureLogDir() {
  if (!fs.existsSync(config.logDir)) {
    fs.mkdirSync(config.logDir, { recursive: true });
  }
}

function logFilePath() {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(config.logDir, `kiosk-${day}.log`);
}

function buildLogger() {
  ensureLogDir();
  const fileStream = pino.destination({
    dest: logFilePath(),
    sync: false,
    mkdir: true,
  });

  const streams: StreamEntry[] = [
    { level: streamLevel, stream: fileStream },
  ];

  if (isDev) {
    // Pretty-print to stdout in dev. In production NSSM captures stdout to
    // its own AppStdout file, which we keep alongside the rolling file log.
    const pretty = pino.transport({
      target: "pino-pretty",
      options: { colorize: true, destination: 1 },
    });
    streams.push({ level: streamLevel, stream: pretty });
  } else {
    streams.push({ level: streamLevel, stream: process.stdout });
  }

  // Re-open the file daily so we get one file per day.
  setInterval(
    () => {
      try {
        fileStream.reopen(logFilePath());
      } catch {
        /* ignore — next write will retry */
      }
    },
    60 * 60 * 1000, // hourly check is enough; reopen() with same path is a no-op via fs reopen
  ).unref();

  return pino(
    {
      level: config.logLevel,
      base: { kioskId: config.kioskId },
    },
    multistream(streams, { dedupe: true }),
  );
}

export const logger = buildLogger();
