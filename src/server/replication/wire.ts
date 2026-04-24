/**
 * Wire-format helpers for replication messages.
 * Events serialize timestamps as epoch ms.
 */
import type { StoredEvent } from "../events";

export interface WireEvent {
  seq: number;
  id: string;
  subjectType: string | null;
  subjectId: string | null;
  action: string;
  kioskId: string;
  createdAt: number;
  payload: Record<string, unknown>;
}

export function toWire(ev: StoredEvent): WireEvent {
  return {
    seq: ev.seq,
    id: ev.id,
    subjectType: ev.subjectType,
    subjectId: ev.subjectId,
    action: ev.action,
    kioskId: ev.kioskId,
    createdAt: ev.createdAt.getTime(),
    payload: ev.payload,
  };
}

export function fromWire(w: WireEvent): StoredEvent {
  return {
    seq: w.seq,
    id: w.id,
    // Trust wire types — schema validates on apply via DB constraints.
    subjectType: w.subjectType as StoredEvent["subjectType"],
    subjectId: w.subjectId,
    action: w.action as StoredEvent["action"],
    kioskId: w.kioskId,
    createdAt: new Date(w.createdAt),
    payload: w.payload,
  };
}

export type PeerMessage =
  | { type: "hello"; kioskId: string; role: "leader" | "follower"; lastSeq: number }
  | { type: "subscribe"; kioskId: string; lastSeq: number }
  | { type: "event"; event: WireEvent }
  | { type: "heartbeat"; leaderId: string; leaderSeq: number; ts: number }
  | { type: "ack"; seq: number };
