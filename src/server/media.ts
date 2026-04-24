/**
 * Media storage for visitor portraits and signatures.
 *
 * Files are written under MEDIA_PATH/visitors/{id}/{photo|signature}.png.
 * On followers, files are fetched from the leader on demand and cached.
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config";
import { getState } from "./replication/state";

function visitorDir(visitorId: string): string {
  return path.join(config.mediaPath, "visitors", visitorId);
}

export interface MediaPaths {
  photoPath: string;
  signaturePath: string;
}

/** Decode a data URL ("data:image/png;base64,XXX") to a Buffer. */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  return Buffer.from(m[1]!, "base64");
}

export async function saveVisitorMedia(
  visitorId: string,
  photoDataUrl: string,
  signatureDataUrl: string,
): Promise<MediaPaths> {
  const dir = visitorDir(visitorId);
  await fs.mkdir(dir, { recursive: true });
  const photoFile = path.join(dir, "photo.png");
  const sigFile = path.join(dir, "signature.png");
  await fs.writeFile(photoFile, dataUrlToBuffer(photoDataUrl));
  await fs.writeFile(sigFile, dataUrlToBuffer(signatureDataUrl));
  // Return paths relative to MEDIA_PATH for portability.
  return {
    photoPath: path.relative(config.mediaPath, photoFile).replace(/\\/g, "/"),
    signaturePath: path.relative(config.mediaPath, sigFile).replace(/\\/g, "/"),
  };
}

export async function readVisitorMedia(
  visitorId: string,
  kind: "photo" | "signature",
): Promise<Buffer> {
  const file = path.join(visitorDir(visitorId), `${kind}.png`);
  if (existsSync(file)) {
    return fs.readFile(file);
  }
  // Follower fallback: fetch from leader and cache locally.
  const leaderUrl = getState().leaderUrl;
  if (!leaderUrl) throw new Error("Media not found locally and no leader to fetch from");
  const res = await fetch(`${leaderUrl}/api/media/${visitorId}/${kind}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Leader media fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(visitorDir(visitorId), { recursive: true });
  await fs.writeFile(file, buf);
  return buf;
}
