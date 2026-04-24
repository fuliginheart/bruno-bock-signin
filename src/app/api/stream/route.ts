/**
 * Server-sent events stream for the kiosk UI.
 * Each event applied locally (whether self-appended or replicated from the
 * leader) is pushed to all connected browsers.
 */
import type { NextRequest } from "next/server";
import { subscribe } from "@/server/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };
      // Initial hello so the client knows it's connected.
      send({ type: "hello", ts: Date.now() });

      const unsub = subscribe((ev) => {
        send({
          type: "event",
          event: {
            ...ev,
            createdAt: ev.createdAt.getTime(),
          },
        });
      });

      // Periodic keep-alive comment.
      const ka = setInterval(() => {
        controller.enqueue(encoder.encode(`: keepalive\n\n`));
      }, 15_000);

      const onAbort = () => {
        clearInterval(ka);
        unsub();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
