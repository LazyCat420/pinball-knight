/**
 * SEMANTIC SOCKETS — Structural placement sockets extracted from track topology.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * In legacy generation, every pass independently scanned the raw grid looking for
 * ad-hoc tile patterns (e.g. any tile with 2 open orthogonal neighbours).
 * Because there was no single semantic representation of a "corner" or a
 * "straight runway", multiple passes would each detect the same corner and place
 * pieces on it or adjacent to it, creating corner clumping, overlapping
 * deflectors/boosters, and steer-lock jams.
 *
 * This module extracts authoritative, non-overlapping semantic sockets directly
 * from the track topology:
 *   - Exactly one `turn` socket per physical corner or bend.
 *   - Exactly one `straight` socket per linear corridor run.
 *   - Dedicated sockets for `launch`, `spine`, `junction`, `room-entry`, `arena`.
 *
 * Pieces request compatible sockets rather than hunting raw tiles.
 */
import {
  type Grid,
  type TilePos,
  at,
  idx,
  isWalkable,
  T_FLOOR,
  T_WALL,
  T_STAIRS,
  T_CRACKED,
} from "./generator";
import { type TrackFloor } from "./track-floor";
import { type Doorway, doorwayFootprint } from "./doorways";

export type SocketRole =
  | "launch"
  | "spine"
  | "straight"
  | "turn"
  | "junction"
  | "bowl"
  | "room-entry"
  | "return"
  | "arena";

export interface Dir {
  di: number;
  dj: number;
}

export interface Socket {
  id: string;
  role: SocketRole;
  tiles: TilePos[];
  anchor: TilePos;
  direction?: Dir;
  direction2?: Dir; // For turns/corners (incoming and outgoing)
  width: number;
  length: number;
  clearance: number;
  wallBacking: "wall" | "open" | "sealed";
  upstream?: string;
  downstream?: string;
  reservedBy?: string;
}

export interface SocketGraph {
  w: number;
  h: number;
  sockets: Socket[];
  byTile: Map<number, Socket>;
  byRole: Record<SocketRole, Socket[]>;
  getSocket(i: number, j: number): Socket | undefined;
  getSocketsByRole(role: SocketRole): readonly Socket[];
}

const CARDS: readonly Dir[] = [
  { di: 1, dj: 0 },
  { di: -1, dj: 0 },
  { di: 0, dj: 1 },
  { di: 0, dj: -1 },
];

/** Measure how many open tiles lie in cardinal direction (di, dj) starting from (i + di, j + dj) */
function openSpan(g: Grid, i: number, j: number, di: number, dj: number, maxSpan = 16): number {
  let count = 0;
  let currI = i + di;
  let currJ = j + dj;
  while (count < maxSpan && currI >= 0 && currI < g.w && currJ >= 0 && currJ < g.h) {
    if (!isWalkable(g, currI, currJ)) break;
    count++;
    currI += di;
    currJ += dj;
  }
  return count;
}

/**
 * Extract the complete, deterministic semantic SocketGraph from a floor.
 */
export function extractSockets(
  g: Grid,
  track: Pick<TrackFloor, "start" | "stairs" | "chute" | "mask">,
  doorways: Doorway[] = [],
): SocketGraph {
  const sockets: Socket[] = [];
  const byTile = new Map<number, Socket>();
  const byRole: Record<SocketRole, Socket[]> = {
    launch: [],
    spine: [],
    straight: [],
    turn: [],
    junction: [],
    bowl: [],
    "room-entry": [],
    return: [],
    arena: [],
  };

  const claimed = new Uint8Array(g.w * g.h);

  // 1. Extract Launch Chute Sockets (Highest Priority)
  if (track.chute) {
    const chute = track.chute;
    const chuteTiles = chute.spine.slice();
    for (const t of chuteTiles) {
      claimed[idx(g, t.i, t.j)] = 1;
    }

    const chuteSocket: Socket = {
      id: "socket-launch-0",
      role: "launch",
      tiles: chuteTiles,
      anchor: chute.base,
      direction: { di: chute.dirI, dj: chute.dirJ },
      width: 1,
      length: chute.spine.length,
      clearance: 1,
      wallBacking: "sealed",
    };
    sockets.push(chuteSocket);
    for (const t of chuteTiles) byTile.set(idx(g, t.i, t.j), chuteSocket);
  }

  // 2. Extract Room-Entry Threshold Sockets (Around doorways)
  let doorIdx = 0;
  for (const d of doorways) {
    const fp = doorwayFootprint(g, d);
    const entryTiles: TilePos[] = [];
    for (const t of fp) {
      if (isWalkable(g, t.i, t.j) && claimed[idx(g, t.i, t.j)] === 0) {
        entryTiles.push(t);
        claimed[idx(g, t.i, t.j)] = 1;
      }
    }
    if (entryTiles.length > 0) {
      const entrySocket: Socket = {
        id: `socket-entry-${doorIdx++}`,
        role: "room-entry",
        tiles: entryTiles,
        anchor: entryTiles[0],
        width: entryTiles.length,
        length: 1,
        clearance: 2,
        wallBacking: "open",
      };
      sockets.push(entrySocket);
      for (const t of entryTiles) byTile.set(idx(g, t.i, t.j), entrySocket);
    }
  }

  // 3. Extract Floor Topological Sockets across remaining walkable tiles
  let socketCount = 0;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      const k = idx(g, i, j);
      if (claimed[k] === 1 || !isWalkable(g, i, j)) continue;

      const openCards: Dir[] = [];
      for (const c of CARDS) {
        if (isWalkable(g, i + c.di, j + c.dj)) openCards.push(c);
      }

      // Check if part of spine / circuit
      const onSpine = track.mask.lane[k] === 1;

      // Case A: 90-degree Corner / Bend (Exactly 2 perpendicular open neighbours)
      if (openCards.length === 2 && openCards[0].di !== -openCards[1].di && openCards[0].dj !== -openCards[1].dj) {
        const [d1, d2] = openCards;
        // Inner backing check: tile diagonally opposite open legs
        const diagI = i - (d1.di + d2.di);
        const diagJ = j - (d1.dj + d2.dj);
        const hasSolidWall = at(g, diagI, diagJ) === T_WALL;

        const turnSocket: Socket = {
          id: `socket-turn-${socketCount++}`,
          role: "turn",
          tiles: [{ i, j }],
          anchor: { i, j },
          direction: d1,
          direction2: d2,
          width: 1,
          length: 1,
          clearance: Math.min(openSpan(g, i, j, d1.di, d1.dj, 5), openSpan(g, i, j, d2.di, d2.dj, 5)),
          wallBacking: hasSolidWall ? "wall" : "open",
        };
        claimed[k] = 1;
        sockets.push(turnSocket);
        byTile.set(k, turnSocket);
        continue;
      }

      // Case B: Straight corridor run (2 opposite open neighbours)
      if (openCards.length === 2 && (openCards[0].di === -openCards[1].di || openCards[0].dj === -openCards[1].dj)) {
        const isHoriz = openCards[0].di !== 0;
        const dir: Dir = isHoriz ? { di: 1, dj: 0 } : { di: 0, dj: 1 };

        const straightSocket: Socket = {
          id: `socket-straight-${socketCount++}`,
          role: onSpine ? "spine" : "straight",
          tiles: [{ i, j }],
          anchor: { i, j },
          direction: dir,
          width: 1,
          length: 1 + openSpan(g, i, j, dir.di, dir.dj, 6) + openSpan(g, i, j, -dir.di, -dir.dj, 6),
          clearance: 3,
          wallBacking: "wall",
        };
        claimed[k] = 1;
        sockets.push(straightSocket);
        byTile.set(k, straightSocket);
        continue;
      }

      // Case C: Junction (3 or 4 open neighbours)
      if (openCards.length >= 3) {
        const junctionSocket: Socket = {
          id: `socket-junction-${socketCount++}`,
          role: "junction",
          tiles: [{ i, j }],
          anchor: { i, j },
          width: 2,
          length: 2,
          clearance: 2,
          wallBacking: "open",
        };
        claimed[k] = 1;
        sockets.push(junctionSocket);
        byTile.set(k, junctionSocket);
        continue;
      }

      // Case D: Dead End / Bowl (1 or 0 open neighbours)
      if (openCards.length <= 1) {
        const exitDir = openCards.length === 1 ? openCards[0] : { di: 0, dj: 0 };
        const bowlSocket: Socket = {
          id: `socket-bowl-${socketCount++}`,
          role: "bowl",
          tiles: [{ i, j }],
          anchor: { i, j },
          direction: exitDir,
          width: 1,
          length: 1,
          clearance: 1,
          wallBacking: "wall",
        };
        claimed[k] = 1;
        sockets.push(bowlSocket);
        byTile.set(k, bowlSocket);
      }
    }
  }

  // Populate byRole map
  for (const s of sockets) {
    byRole[s.role].push(s);
  }

  return {
    w: g.w,
    h: g.h,
    sockets,
    byTile,
    byRole,
    getSocket(i: number, j: number) {
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) return undefined;
      return byTile.get(idx(g, i, j));
    },
    getSocketsByRole(role: SocketRole) {
      return byRole[role];
    },
  };
}
