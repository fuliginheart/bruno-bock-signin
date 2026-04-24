/**
 * Single entrypoint for client-driven mutations.
 *
 * - On the leader: appends locally.
 * - On a follower: forwards the request to the leader's same endpoint.
 * - If the leader is unreachable, returns a 503 and triggers re-election.
 */
import { logger } from "./logger";
import { appendEvent, type EventInput, type StoredEvent } from "./events";
import { getState } from "./replication/state";
import { runElection } from "./replication/coordinator";

const FORWARD_TIMEOUT_MS = 3000;

export class ReplicationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function applyMutation(input: EventInput): Promise<StoredEvent> {
  const state = getState();
  if (state.role === "leader" || state.peers.length === 0) {
    return appendEvent(input);
  }
  if (!state.leaderUrl) {
    void runElection();
    throw new ReplicationError("No leader currently available.", 503);
  }
  // Forward to leader.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(`${state.leaderUrl}/api/replication/forward`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new ReplicationError(
        `Leader rejected mutation: HTTP ${res.status}`,
        res.status,
      );
    }
    const raw = (await res.json()) as StoredEvent & { createdAt: string };
    return { ...raw, createdAt: new Date(raw.createdAt) };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, leader: state.leaderUrl },
      "forward to leader failed; triggering re-election",
    );
    void runElection();
    throw new ReplicationError(
      `Leader unreachable: ${(err as Error).message}`,
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}
