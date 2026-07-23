/**
 * 🏰 Session handoff — the baton passed from the tavern to the dungeon.
 *
 * When the lobby forms a party, the tavern stashes the session details here and
 * descends. The dungeon reads them on entry to know whether this is a co-op run,
 * which role it plays (0 = host/authority), and who its party is.
 *
 * In increment 1 (social tavern only) the dungeon ignores the pending session
 * and every knight drops into their own single-player run — the baton is set but
 * not yet consumed. Increment 2 wires the dungeon to consume it and connect to
 * the `/ws` session channel.
 */
import type { PartyMember } from "./protocol";

export interface PendingSession {
  sessionId: string;
  role: number; // 0 = host
  members: PartyMember[];
  hostId: string;
  solo: boolean;
  /** Server-assigned floor seed — every party member generates identical mazes. */
  seed: number;
}

let pending: PendingSession | null = null;

export function setPendingSession(s: PendingSession | null): void {
  pending = s;
}

/** Peek without clearing — the dungeon can check "am I in a co-op run?". */
export function peekPendingSession(): PendingSession | null {
  return pending;
}

/** Take the pending session (clears it), or null if this is a solo/local run. */
export function consumePendingSession(): PendingSession | null {
  const s = pending;
  pending = null;
  return s;
}
