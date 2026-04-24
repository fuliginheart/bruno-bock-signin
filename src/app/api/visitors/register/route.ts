/**
 * POST /api/visitors/register
 * Body: {
 *   firstName, lastName, company, reason, hostEmployeeId,
 *   photoDataUrl, signatureDataUrl
 * }
 *
 * Creates the visitor row + initial sign-in event. Both events go through
 * the leader (followers proxy via applyMutation).
 *
 * NOTE: visitor media is saved locally on whichever node accepts the request.
 * Followers will fetch on demand from the leader and cache.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ulid } from "ulid";
import { applyMutation, ReplicationError } from "@/server/mutations";
import { saveVisitorMedia } from "@/server/media";
import { getState } from "@/server/replication/state";
import { config } from "@/server/config";

export const dynamic = "force-dynamic";

const Input = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  company: z.string().min(1).max(120),
  reason: z.string().min(1).max(500),
  hostEmployeeId: z.string().min(1).nullable(),
  photoDataUrl: z.string().startsWith("data:image/"),
  signatureDataUrl: z.string().startsWith("data:image/"),
  trainingConfirmedAt: z.string().datetime().optional(),
  // When set, we update the existing visitor rather than creating a new one.
  existingVisitorId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const visitorId = data.existingVisitorId ?? ulid();
  const isReturning = !!data.existingVisitorId;

  // Save media locally so this kiosk can serve it immediately.
  let mediaPaths;
  try {
    mediaPaths = await saveVisitorMedia(
      visitorId,
      data.photoDataUrl,
      data.signatureDataUrl,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to save media: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  try {
    if (isReturning) {
      // Returning visitor: update their existing record (new photo/sig/info)
      // then sign them in.
      await applyMutation({
        action: "visitor_update",
        subjectType: "visitor",
        subjectId: visitorId,
        payload: {
          id: visitorId,
          firstName: data.firstName,
          lastName: data.lastName,
          company: data.company,
          reason: data.reason,
          hostEmployeeId: data.hostEmployeeId,
          photoPath: mediaPaths.photoPath,
          signaturePath: mediaPaths.signaturePath,
          trainingConfirmedAt: data.trainingConfirmedAt
            ? new Date(data.trainingConfirmedAt).getTime()
            : null,
        },
      });
    } else {
      // New visitor: create the record.
      await applyMutation({
        action: "visitor_register",
        subjectType: "visitor",
        subjectId: visitorId,
        payload: {
          id: visitorId,
          firstName: data.firstName,
          lastName: data.lastName,
          company: data.company,
          reason: data.reason,
          hostEmployeeId: data.hostEmployeeId,
          photoPath: mediaPaths.photoPath,
          signaturePath: mediaPaths.signaturePath,
          trainingConfirmedAt: data.trainingConfirmedAt
            ? new Date(data.trainingConfirmedAt).getTime()
            : null,
        },
      });
    }
    // Sign them in (works for both new and returning visitors).
    await applyMutation({
      action: "sign_in",
      subjectType: "visitor",
      subjectId: visitorId,
      payload: { subjectType: "visitor", subjectId: visitorId },
    });

    // If we forwarded to the leader, the leader doesn't have the media file.
    // Best-effort upload it now.
    const state = getState();
    if (state.role !== "leader" && state.leaderUrl) {
      try {
        await fetch(`${state.leaderUrl}/api/media/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId,
            photoDataUrl: data.photoDataUrl,
            signatureDataUrl: data.signatureDataUrl,
            originKioskId: config.kioskId,
          }),
        });
      } catch {
        // Leader will fetch on demand; this is best-effort warmup.
      }
    }

    return NextResponse.json({ ok: true, id: visitorId });
  } catch (err) {
    if (err instanceof ReplicationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
