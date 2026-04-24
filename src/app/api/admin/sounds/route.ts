/**
 * POST /api/admin/sounds  (multipart: key, file)
 *   Saves an audio file to public/sounds/ and stores its URL in settings.
 * DELETE /api/admin/sounds?key=...
 *   Removes the file and clears the setting.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/server/admin-guard";
import { applyMutation } from "@/server/mutations";
import path from "path";
import fs from "fs/promises";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS = ["sound_sign_in", "sound_sign_out"] as const;
type SoundKey = (typeof ALLOWED_KEYS)[number];

const ALLOWED_EXTS = ["mp3", "wav", "ogg", "webm", "aac", "m4a"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function soundsDir() {
  return path.join(process.cwd(), "public", "sounds");
}

/** Remove any existing file(s) for this key regardless of extension. */
async function removeExisting(key: string) {
  const dir = soundsDir();
  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter((f) => f.startsWith(key + "."))
        .map((f) => fs.unlink(path.join(dir, f)).catch(() => {})),
    );
  } catch {
    // directory may not exist yet
  }
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const key = formData.get("key") as string | null;
  const file = formData.get("file") as File | null;

  if (!key || !ALLOWED_KEYS.includes(key as SoundKey)) {
    return NextResponse.json(
      { error: `key must be one of: ${ALLOWED_KEYS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!file || !file.size) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 10 MB)" },
      { status: 400 },
    );
  }

  const nameParts = file.name.toLowerCase().split(".");
  const ext = nameParts[nameParts.length - 1];
  if (!ALLOWED_EXTS.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported format. Allowed: ${ALLOWED_EXTS.join(", ")}` },
      { status: 400 },
    );
  }

  const filename = `${key}.${ext}`;
  const dir = soundsDir();
  await fs.mkdir(dir, { recursive: true });
  await removeExisting(key);
  await fs.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

  // Cache-bust the URL so browsers pick up the new file immediately.
  const url = `/sounds/${filename}?v=${Date.now()}`;

  await applyMutation({
    action: "setting_set",
    payload: { key, value: url },
  });

  return NextResponse.json({ ok: true, url });
}

export async function DELETE(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const urlObj = new URL(req.url);
  const key = urlObj.searchParams.get("key");

  if (!key || !ALLOWED_KEYS.includes(key as SoundKey)) {
    return NextResponse.json(
      { error: `key must be one of: ${ALLOWED_KEYS.join(", ")}` },
      { status: 400 },
    );
  }

  await removeExisting(key);
  await applyMutation({
    action: "setting_set",
    payload: { key, value: "" },
  });

  return NextResponse.json({ ok: true });
}
