/**
 * Follower-side WebSocket client. Connects to the elected leader, subscribes
 * for events from `lastSeq`, and applies them idempotently to the local DB.
 *
 * Detects loss of heartbeat to trigger re-election in the coordinator.
 */
import WebSocket from "ws";
import { logger } from "../logger";
import { config } from "../config";
import { applyRemoteEvent, getMaxSeq } from "../events";
import {
  getState,
  bumpHeartbeat,
  setLeader,
  setLastAppliedSeq,
} from "./state";
import { fromWire, type PeerMessage } from "./wire";

let socket: WebSocket | null = null;
let watchdog: NodeJS.Timeout | null = null;
let onLossCallback: (() => void) | null = null;

const HEARTBEAT_TIMEOUT_MS = 15000;

function clearWatchdog() {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

export function disconnectFromLeader() {
  clearWatchdog();
  if (socket) {
    socket.removeAllListeners();
    try {
      socket.close();
    } catch {}
    socket = null;
  }
}

export interface ConnectArgs {
  leaderId: string;
  leaderHttpUrl: string; // e.g. http://10.0.0.21:3000
  onLeaderLoss: () => void;
}

function httpToWs(httpUrl: string): string {
  return httpUrl.replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"));
}

export function connectToLeader(args: ConnectArgs) {
  disconnectFromLeader();
  onLossCallback = args.onLeaderLoss;

  const wsUrl = `${httpToWs(args.leaderHttpUrl)}/ws/peer`;
  logger.info({ leaderId: args.leaderId, wsUrl }, "connecting to leader");
  const ws = new WebSocket(wsUrl, { handshakeTimeout: 3000 });
  socket = ws;

  ws.on("open", () => {
    setLeader(args.leaderId, args.leaderHttpUrl);
    bumpHeartbeat();
    const sub: PeerMessage = {
      type: "subscribe",
      kioskId: config.kioskId,
      lastSeq: getMaxSeq(),
    };
    ws.send(JSON.stringify(sub));

    clearWatchdog();
    watchdog = setInterval(() => {
      // If the socket is still OPEN, treat that as proof of life — TCP would
      // have dropped it already if the server process had died. Only fire
      // re-election when the socket has gone silent AND is no longer open
      // (catches silent network-partition scenarios on a LAN).
      if (ws.readyState === ws.OPEN) {
        bumpHeartbeat(); // keep the health-API clock fresh
        return;
      }
      const since = Date.now() - getState().lastLeaderHeartbeat;
      if (since > HEARTBEAT_TIMEOUT_MS) {
        logger.warn({ since }, "leader heartbeat timeout");
        const cb = onLossCallback;
        disconnectFromLeader();
        cb?.();
      }
    }, 1000);
  });

  ws.on("message", (raw) => {
    let msg: PeerMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "event") {
      const ev = fromWire(msg.event);
      try {
        applyRemoteEvent(ev);
        setLastAppliedSeq(ev.seq);
        const ack: PeerMessage = { type: "ack", seq: ev.seq };
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ack));
      } catch (err) {
        logger.error(
          { err: (err as Error).message, evId: ev.id },
          "failed to apply remote event",
        );
      }
    } else if (msg.type === "heartbeat") {
      bumpHeartbeat();
    }
  });

  ws.on("close", () => {
    logger.warn("disconnected from leader");
    clearWatchdog();
    const cb = onLossCallback;
    socket = null;
    cb?.();
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message }, "leader socket error");
  });
}
