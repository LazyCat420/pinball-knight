/**
 * 🕸️ Realtime protocol — client MIRROR of the wire contract.
 *
 * The canonical definition lives in
 * `braindeadbot-service/src/realtime/protocol.ts`. This file must track it
 * exactly (same convention the score/youtube service clients use). A payload
 * that drifts from the server's shape is a silent desync, not a compile error,
 * so treat any edit here as an edit to both repos.
 */

// ── Pool sizing (kept in sync with the server) ────────────────────────────────
export const POOL_MAX = 24;
export const TAVERN_MAX = 8; // legacy (dormant party code)
export const PARTY_MAX = 4;
export const PARTY_MIN = 2;

// ── The eight knight colors (join-order slots) ───────────────────────────────
export interface KnightColor {
  slot: number;
  name: string;
  hex: number;
}
export const KNIGHT_COLORS: readonly KnightColor[] = [
  { slot: 0, name: "Crimson", hex: 0xe05050 },
  { slot: 1, name: "Cobalt", hex: 0x5080e0 },
  { slot: 2, name: "Ember", hex: 0xe09030 },
  { slot: 3, name: "Sage", hex: 0x50c878 },
  { slot: 4, name: "Violet", hex: 0xa050e0 },
  { slot: 5, name: "Gold", hex: 0xf0c040 },
  { slot: 6, name: "Frost", hex: 0x70d0e0 },
  { slot: 7, name: "Iron", hex: 0x909090 },
] as const;

/** Color for a slot, wrapping defensively if the server ever sends an odd one. */
export function colorForSlot(slot: number): KnightColor {
  if (slot < 0) return { slot: -1, name: "Waiting", hex: 0x808080 };
  return KNIGHT_COLORS[slot % KNIGHT_COLORS.length];
}

export type Facing = "N" | "S" | "E" | "W";

export interface RemoteKnight {
  id: string;
  slot: number;
  name: string;
  x: number;
  z: number;
  facing: Facing;
  ready: boolean;
  /** "tavern" | "dungeon:<floor>" — renderers show only same-scene peers. */
  scene: string;
}

export interface PartyMember {
  id: string;
  slot: number;
  name: string;
  role: number; // 0 = host
}

// ── Client → Server ──────────────────────────────────────────────────────────
export type ClientMessage =
  | { type: "hello"; name: string; preferredSlot?: number }
  | { type: "move"; x: number; z: number; facing: Facing; scene: string; mode?: string }
  // World channel: `world` = the floor authority's enemy/loot/boss snapshot,
  // `act` = discrete game events (hit forwards, kills, loot takes, boss slams).
  // Server relays both to same-scene peers only.
  | { type: "world"; scene: string; snap: unknown }
  | { type: "act"; scene: string; act: unknown }
  | { type: "session:hello"; sessionId: string }
  | { type: "session:snapshot"; sessionId: string; snap: unknown }
  | { type: "session:input"; sessionId: string; input: unknown }
  | { type: "session:event"; sessionId: string; event: unknown }
  | { type: "session:leave"; sessionId: string }
  | { type: "ping" };

// ── Server → Client ──────────────────────────────────────────────────────────
export type ServerMessage =
  | { type: "welcome"; id: string; slot: number; name: string; colors: readonly KnightColor[]; seed: number }
  | { type: "room:state"; players: RemoteKnight[] }
  | { type: "player:join"; player: RemoteKnight }
  | { type: "player:leave"; id: string }
  | { type: "room:full" }
  | { type: "player:move"; id: string; x: number; z: number; facing: Facing; scene: string; mode?: string }
  | { type: "world"; fromId: string; scene: string; snap: unknown }
  | { type: "act"; fromId: string; scene: string; act: unknown }
  | { type: "player:ready"; id: string; ready: boolean }
  | { type: "party:forming"; members: string[]; seconds: number }
  | { type: "party:tick"; seconds: number }
  | { type: "party:cancelled"; reason: "bailed" | "disconnected" }
  | { type: "party:start"; sessionId: string; members: PartyMember[]; role: number; hostId: string; seed: number }
  | { type: "solo:countdown"; seconds: number }
  | { type: "solo:start"; sessionId: string; seed: number }
  | { type: "session:state"; members: PartyMember[]; hostId: string; role: number; seed: number }
  | { type: "session:snapshot"; snap: unknown }
  | { type: "session:input"; fromId: string; input: unknown }
  | { type: "session:event"; fromId: string; event: unknown }
  | { type: "session:peer-left"; id: string; newHostId?: string }
  | { type: "session:ended"; reason: string }
  | { type: "pong" };

export type ServerMessageType = ServerMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;
