/**
 * Leader-side WebSocket server. Accepts follower connections, replays the
 * event log from their `lastSeq`, then streams new events as they're appended.
 *
 * Live event delivery uses DB polling rather than the subscribe/notify pattern
 * because Next.js app-router route handlers run in a sandboxed VM context with
 * their own globalThis — so notify() fired from a route handler never reaches
 * the subscriber registered here in server.ts context.
 */
import { WebSocketServer, type WebSocket } from "ws";
import { logger } from "../logger";
import { config } from "../config";
import { readEventsSince, getMaxSeq } from "../events";
import { onRoleChange, getState } from "./state";
import { toWire, type PeerMessage } from "./wire";

interface FollowerConn {
  socket: WebSocket;
  kioskId: string;
  lastSeq: number;
}

// Pin mutable state to globalThis so Next.js hot-module-reloads don't wipe it.
const HUB_KEY = Symbol.for("bb.leaderHub.v2");
type GlobalWithHub = typeof globalThis & {
  [HUB_KEY]?: {
    followers: Set<FollowerConn>;
    pollTimer: NodeJS.Timeout | null;
    heartbeatTimer: NodeJS.Timeout | null;
    lastBroadcastSeq: number;
  };
};
const gHub = globalThis as GlobalWithHub;
if (!gHub[HUB_KEY]) {
  gHub[HUB_KEY] = {
    followers: new Set(),
    pollTimer: null,
    heartbeatTimer: null,
    lastBroadcastSeq: 0,
  };
}
const hub = gHub[HUB_KEY]!;
const followers = hub.followers;

function send(ws: WebSocket, msg: PeerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastHeartbeat() {
  const msg: PeerMessage = {
    type: "heartbeat",
    leaderId: config.kioskId,
    leaderSeq: getMaxSeq(),
    ts: Date.now(),
  };
  for (const f of followers) send(f.socket, msg);
}

/**
 * Poll the DB every 200ms for new events and push them to all followers.
 * This works across VM context boundaries (Next.js route handlers vs server.ts).
 */
function pollAndBroadcast() {
  if (getState().role !== "leader") return;
  if (followers.size === 0) return;

  const newEvents = readEventsSince(hub.lastBroadcastSeq);
  for (const ev of newEvents) {
    const msg: PeerMessage = { type: "event", event: toWire(ev) };
    for (const f of followers) {
      // Only send events the follower doesn't already have.
      if (ev.seq > f.lastSeq) {
        send(f.socket, msg);
      }
    }
    hub.lastBroadcastSeq = ev.seq;
  }
}

function handleConnection(ws: WebSocket) {
  let conn: FollowerConn | null = null;

  ws.on("message", (raw) => {
    let msg: PeerMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close();
      return;
    }
    if (msg.type === "subscribe") {
      conn = { socket: ws, kioskId: msg.kioskId, lastSeq: msg.lastSeq };
      followers.add(conn);
      logger.info(
        { follower: msg.kioskId, lastSeq: msg.lastSeq },
        "follower subscribed",
      );
      // Replay missed events.
      const batch = readEventsSince(msg.lastSeq);
      for (const ev of batch) {
        send(ws, { type: "event", event: toWire(ev) });
        conn.lastSeq = ev.seq;
      }
      // Initial heartbeat so follower knows we're live.
      send(ws, {
        type: "heartbeat",
        leaderId: config.kioskId,
        leaderSeq: getMaxSeq(),
        ts: Date.now(),
      });
    } else if (msg.type === "ack" && conn) {
      conn.lastSeq = Math.max(conn.lastSeq, msg.seq);
    }
  });

  ws.on("close", () => {
    if (conn) {
      followers.delete(conn);
      logger.info({ follower: conn.kioskId }, "follower disconnected");
    }
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message }, "follower socket error");
  });
}

export function startLeaderHub(wss: WebSocketServer) {
  wss.on("connection", handleConnection);

  // React to role changes for the lifetime of this process.
  onRoleChange((role) => {
    if (role === "leader") {
      // (Re-)start polling whenever we become leader — this also covers the
      // common case where startCoordinator() calls setRole("candidate") right
      // after startLeaderHub() and then immediately self-promotes back to
      // "leader", which would have left the poll timer cleared.
      hub.lastBroadcastSeq = getMaxSeq();
      if (hub.pollTimer) clearInterval(hub.pollTimer);
      hub.pollTimer = setInterval(pollAndBroadcast, 200);
      if (hub.heartbeatTimer) clearInterval(hub.heartbeatTimer);
      hub.heartbeatTimer = setInterval(broadcastHeartbeat, 2000);
    } else {
      logger.info("stepping down as leader; closing follower connections");
      for (const f of followers) f.socket.close();
      followers.clear();
      if (hub.pollTimer) { clearInterval(hub.pollTimer); hub.pollTimer = null; }
      if (hub.heartbeatTimer) { clearInterval(hub.heartbeatTimer); hub.heartbeatTimer = null; }
    }
  });
}

export function followerCount() {
  return followers.size;
}
