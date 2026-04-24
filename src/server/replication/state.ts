/**
 * Process-wide replication state. Singleton.
 *
 * In Next.js dev mode (and even in some prod scenarios) a module can be
 * loaded multiple times — once by our custom server.ts, again by the route
 * handler bundle. Each instance would otherwise see its own copy of `state`
 * and the API would lie about the role. We pin the state + emitter onto
 * globalThis so every module load shares the same objects.
 */
import { EventEmitter } from "node:events";
import type { StoredEvent } from "../events";

export type Role = "leader" | "follower" | "candidate" | "starting";

interface ReplicationState {
  role: Role;
  leaderId: string | null;
  leaderUrl: string | null;
  lastAppliedSeq: number;
  peers: string[];
  lastLeaderHeartbeat: number; // epoch ms
}

interface SharedSlot {
  state: ReplicationState;
  emitter: EventEmitter;
}

const SHARED_KEY = Symbol.for("bb.replication.shared.v1");
type GlobalWithSlot = typeof globalThis & { [SHARED_KEY]?: SharedSlot };
const g = globalThis as GlobalWithSlot;

if (!g[SHARED_KEY]) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  g[SHARED_KEY] = {
    state: {
      role: "starting",
      leaderId: null,
      leaderUrl: null,
      lastAppliedSeq: 0,
      peers: [],
      lastLeaderHeartbeat: 0,
    },
    emitter,
  };
}

const state = g[SHARED_KEY]!.state;
const emitter = g[SHARED_KEY]!.emitter;

export function getState(): Readonly<ReplicationState> {
  return state;
}

export function setRole(role: Role) {
  if (state.role === role) return;
  state.role = role;
  emitter.emit("role", role);
}

export function setLeader(id: string | null, url: string | null) {
  state.leaderId = id;
  state.leaderUrl = url;
  state.lastLeaderHeartbeat = Date.now();
}

export function setPeers(peers: string[]) {
  state.peers = [...peers];
}

export function bumpHeartbeat() {
  state.lastLeaderHeartbeat = Date.now();
}

export function setLastAppliedSeq(seq: number) {
  if (seq > state.lastAppliedSeq) state.lastAppliedSeq = seq;
}

export function onRoleChange(fn: (role: Role) => void) {
  emitter.on("role", fn);
  return () => emitter.off("role", fn);
}

export function onEventBroadcast(fn: (ev: StoredEvent) => void) {
  emitter.on("event", fn);
  return () => emitter.off("event", fn);
}

export function broadcastEvent(ev: StoredEvent) {
  emitter.emit("event", ev);
}
