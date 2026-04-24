import { NextRequest, NextResponse } from "next/server";
import { ulid } from "ulid";
import { requireAdmin } from "@/server/admin-guard";
import { applyMutation, ReplicationError } from "@/server/mutations";

export const dynamic = "force-dynamic";

function parseCsv(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (char === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return undefined;
}

export async function POST(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const contentType = req.headers.get("content-type") ?? "";
  let rawCsv = "";

  if (contentType.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    rawCsv = file instanceof Blob ? await file.text() : String(file ?? "");
  } else {
    rawCsv = await req.text();
  }

  if (!rawCsv.trim()) {
    return NextResponse.json({ error: "CSV body is required." }, { status: 400 });
  }

  const rows = parseCsv(rawCsv);
  if (rows.length === 0) {
    return NextResponse.json({ error: "CSV content is empty." }, { status: 400 });
  }

  const header = rows[0].map((text) => text.trim().toLowerCase());
  const idIndex = header.findIndex((name) => name === "id");
  const displayNameIndex = header.findIndex((name) => name === "displayname" || name === "display_name");
  const activeIndex = header.findIndex((name) => name === "active");

  if (displayNameIndex === -1) {
    return NextResponse.json(
      { error: "CSV must contain a displayName or display_name column." },
      { status: 400 },
    );
  }

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const displayName = row[displayNameIndex]?.trim();
    const id = idIndex !== -1 ? row[idIndex]?.trim() : "";
    const active = parseBoolean(activeIndex !== -1 ? row[activeIndex]?.trim() : undefined);

    if (!displayName) {
      errors.push(`Row ${rowIndex + 1} is missing a displayName.`);
      continue;
    }

    try {
      await applyMutation({
        action: "employee_upsert",
        payload: {
          id: id || ulid(),
          displayName,
          active: active ?? true,
        },
      });
      if (id) {
        updated += 1;
      } else {
        created += 1;
      }
    } catch (err) {
      if (err instanceof ReplicationError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      errors.push(`Row ${rowIndex + 1}: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "Import completed with errors.", errors }, { status: 400 });
  }

  return NextResponse.json({ ok: true, created, updated });
}
