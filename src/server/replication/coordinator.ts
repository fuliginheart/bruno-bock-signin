/**
 * Coordinator: orchestrates leader election and role transitions.
 *
 * Election algorithm (simple, LAN-only):
 *   1. Probe every peer's /api/replication/identity. If any responds as
 *      "leader" with a fresh heartbeat, become its follower.
 *   2. Otherwise: among reachable peers (including self), the candidate with
 *      the highest `lastSeq` wins. Tiebreak: lexicographically smallest
 *      kioskId. The winner self-promotes to leader.
 *   3. Re-run on leader loss or periodic interval.
 */
import { logger } from "../logger";
import { config } from "../config";
import { getMaxSeq } from "../events";
import {
  getState,
  setRole,
  setLeader,
  setPeers,
  bumpHeartbeat,
} from "./state";
import { connectToLeader, disconnectFromLeader } from "./follower-client";

const PROBE_TIMEOUT_MS = 4000;
const PERIODIC_CHECK_MS = 10_000;

interface PeerIdentity {
  url: string;
  kioskId?: string;
  role?: "leader" | "follower" | "candidate" | "starting";
  lastSeq?: number;
  reachable: boolean;
}

async function probe(url: string): Promise<PeerIdentity> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/api/replication/identity`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return { url, reachable: false };
    const body = (await res.json()) as {
      kioskId: string;
      role: PeerIdentity["role"];
      lastSeq: number;
    };
    return { url, ...body, reachable: true };
  } catch {
    return { url, reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

let running = false;
let periodicTimer: NodeJS.Timeout | null = null;
let electionInFlight: Promise<void> | null = null;

export async function runElection(): Promise<void> {
  if (electionInFlight) return electionInFlight;
  electionInFlight = (async () => {
    setRole("candidate");
    const peers = config.peers;
    setPeers(peers);

    const identities = await Promise.all(peers.map(probe));
    logger.info(
      { peers: identities.map((p) => ({ url: p.url, role: p.role, reachable: p.reachable })) },
      "election: peer probe results",
    );

    // Step 1: prefer an existing live leader.
    const existingLeader = identities.find(
      (p) => p.reachable && p.role === "leader" && p.kioskId,
    );
    if (existingLeader && existingLeader.kioskId !== config.kioskId) {
      becomeFollower(existingLeader.kioskId!, existingLeader.url);
      return;
    }

    // Step 2: highest lastSeq wins; tiebreak by smallest kioskId.
    const myLastSeq = getMaxSeq();
    const candidates = [
      { kioskId: config.kioskId, lastSeq: myLastSeq, url: null as string | null },
      ...identities
        .filter((p) => p.reachable && p.kioskId)
        .map((p) => ({
          kioskId: p.kioskId!,
          lastSeq: p.lastSeq ?? 0,
          url: p.url,
        })),
    ];
    candidates.sort((a, b) => {
      if (b.lastSeq !== a.lastSeq) return b.lastSeq - a.lastSeq;
      return a.kioskId.localeCompare(b.kioskId);
    });
    const winner = candidates[0]!;

    if (winner.kioskId === config.kioskId) {
      becomeLeader();
    } else if (winner.url) {
      becomeFollower(winner.kioskId, winner.url);
    } else {
      // Shouldn't happen, but fall back to leader.
      becomeLeader();
    }
  })().finally(() => {
    electionInFlight = null;
  });
  return electionInFlight;
}

function becomeLeader() {
  logger.info("self-promoting to leader");
  setLeader(config.kioskId, null);
  bumpHeartbeat();
  disconnectFromLeader();
  setRole("leader");
}

function becomeFollower(leaderId: string, leaderUrl: string) {
  logger.info({ leaderId, leaderUrl }, "becoming follower");
  setLeader(leaderId, leaderUrl);
  setRole("follower");
  connectToLeader({
    leaderId,
    leaderHttpUrl: leaderUrl,
    onLeaderLoss: () => {
      logger.warn("lost leader; re-electing");
      void runElection();
    },
  });
}

export function startCoordinator() {
  if (running) return;
  running = true;
  void runElection();
  periodicTimer = setInterval(() => {
    const state = getState();
    if (state.role === "leader") return; // leaders hold until they crash or a follower takes over
    if (state.role === "follower") {
      const since = Date.now() - state.lastLeaderHeartbeat;
      if (since > 15000) void runElection();
    } else {
      void runElection();
    }
  }, PERIODIC_CHECK_MS);
}

export function stopCoordinator() {
  running = false;
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
  disconnectFromLeader();
}
