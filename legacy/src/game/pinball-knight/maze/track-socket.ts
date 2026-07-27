/**
 * SOCKETS — the plumbing contract for floor geometry.
 *
 * ── The problem this exists to solve ──────────────────────────────────────
 *
 * Every pass in this generator used to place geometry by POSITION and never
 * asked what was at the other end of it. So the floor filled up with pieces
 * that were individually legal and collectively nonsense:
 *
 *   · curved wall segments that start and stop in open air
 *   · corridors that dead-end into other dead-ends
 *   · boosters firing straight into a curved wall
 *
 * Measured on 20 generated floors before this module existed:
 *   **105.8 dead ends per floor** (a walkable tile walled on 3 sides),
 *   **116.4 wall stubs per floor** (a wall tile with 3+ open neighbours — the
 *   nubs that jut into a room and read as unfinished), and
 *   **11.3% of launchers** firing into a wall within 3 tiles.
 *
 * ── The fix, and why it's this one ────────────────────────────────────────
 *
 * This is the standard SOCKET model from modular level generation, and the
 * same consistency idea Wave Function Collapse is built on: a piece is not
 * valid because of where it sits, it is valid because **every one of its edges
 * agrees with its neighbour's edge**. WFC calls the invariant arc consistency;
 * modular road/track kits call the labelled endpoints sockets. Same contract.
 *
 * A socket here is a typed label on one EDGE of one tile:
 *
 *      ROAD  — rideable track surface; a ball may cross this edge at speed
 *      ROOM  — open floor, walkable, but not part of the circuit
 *      WALL  — solid; nothing crosses
 *      RIM   — the shoulder of a banked curve: solid, but the ball rides it
 *
 * and the compatibility table below says which may face which. The table IS
 * the plumbing diagram — one place to read "what can connect to what".
 *
 * Being explicit about the limits, because a half-understood constraint system
 * is worse than none: this module does NOT run a WFC solver. A full solver
 * would have to place every tile, and the floor is already produced by a
 * physically-motivated growth model (track-grow.ts) that we want to keep. What
 * this gives is the other half of WFC — the CONSTRAINT and the CHECK — applied
 * as a validation and repair pass over the generated grid. That catches the
 * three defects above without throwing away the generator that makes the
 * layout interesting.
 *
 * DOM- and three-free. Pure.
 */
import { type Grid, type TilePos, T_WALL, T_FLOOR, T_STAIRS, T_CRACKED, at, idx, isWalkable, setTile } from "./generator";
import type { TrackMask } from "./track-carve";

/** A typed edge label. The whole plumbing vocabulary. */
export type Socket = "road" | "room" | "wall" | "rim";

/** The four cardinal edges of a tile, in a fixed order. */
export const DIRS = [
  { di: 1, dj: 0 },
  { di: -1, dj: 0 },
  { di: 0, dj: 1 },
  { di: 0, dj: -1 },
] as const;

/**
 * THE PLUMBING TABLE — which socket may face which.
 *
 * Read it as "if my edge is X, my neighbour's facing edge may be any of Y".
 * It is deliberately symmetric; `assertSymmetric` in the tests pins that,
 * because an asymmetric table would make validity depend on which tile you
 * asked first, and that bug is invisible until it isn't.
 *
 * ⚠️ CORRECTION, kept because the wrong version is the intuitive one. This
 * table first forbade `road`↔`wall`, on the reasoning that a highway meeting a
 * wall is the "stops in mid-air" defect. That is wrong, and measurably so:
 * every real floor reported ~2800 violations and every single one was
 * `road|wall`. Of course it was — **a road has walls along both of its sides**.
 * That is what a road IS.
 *
 * The defect was never "road touches wall". It is a road that touches wall at
 * its **END**, i.e. a lane tile whose only continuations are solid. That is a
 * property of a tile's whole neighbourhood, not of one edge, so it cannot live
 * in an edge-compatibility table at all — it is checked by
 * `findRoadTerminations` below. Edge sockets stay permissive; the topological
 * check does the work.
 */
const COMPAT: Record<Socket, ReadonlySet<Socket>> = {
  road: new Set<Socket>(["road", "rim", "room", "wall"]),
  room: new Set<Socket>(["room", "road", "wall", "rim"]),
  wall: new Set<Socket>(["wall", "room", "rim", "road"]),
  rim: new Set<Socket>(["rim", "road", "wall", "room"]),
};

/** May a tile whose edge is `a` sit against a tile whose facing edge is `b`? */
export function compatible(a: Socket, b: Socket): boolean {
  return COMPAT[a].has(b);
}

/**
 * The socket a tile presents on every edge.
 *
 * Derived from the grid + the track mask rather than stored, so it cannot drift
 * out of sync with the tiles the way a parallel array would. A tile is `road`
 * if the circuit claimed it, `room` if it is walkable but off-circuit, `rim` if
 * it is a wall carrying a published arc face (the banked shoulder), else
 * `wall`.
 */
export function socketAt(g: Grid, mask: TrackMask | null, i: number, j: number): Socket {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return "wall";
  const k = idx(g, i, j);
  if (isWalkable(g, i, j)) {
    return mask && mask.lane[k] === 1 ? "road" : "room";
  }
  // A wall tile that owns an arc face is the RIM of a banked curve.
  if (g.arcIdx && g.arcIdx[k] >= 0) return "rim";
  return "wall";
}

/**
 * Does a SEALED lane tile (see TrackMask.sealed) sit within two tiles?
 *
 * Two rather than one because the repair passes reason about membranes: a wall
 * directly against the lane is the seal, and the one behind it is what stops
 * the seal from being a single tile thick — and a one-tile membrane is exactly
 * what `removeWallStubs` is built to delete.
 */
export function nearSealed(g: Grid, mask: TrackMask, i: number, j: number): boolean {
  for (let dj = -2; dj <= 2; dj++) {
    for (let di = -2; di <= 2; di++) {
      const x = i + di;
      const y = j + dj;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      if (mask.sealed[idx(g, x, y)] === 1) return true;
    }
  }
  return false;
}

/** One place where two adjacent tiles present incompatible sockets. */
export interface SocketViolation {
  i: number;
  j: number;
  di: number;
  dj: number;
  a: Socket;
  b: Socket;
}

/**
 * Every adjacent pair whose sockets do not mate.
 *
 * This is the acceptance test for the whole generator: a floor that ships with
 * violations is a floor with visible nonsense in it. Bounded by `limit` so a
 * catastrophically broken floor reports fast instead of building a
 * million-entry array.
 */
export function findSocketViolations(g: Grid, mask: TrackMask | null, limit = 5000): SocketViolation[] {
  const out: SocketViolation[] = [];
  for (let j = 0; j < g.h && out.length < limit; j++) {
    for (let i = 0; i < g.w && out.length < limit; i++) {
      const a = socketAt(g, mask, i, j);
      // Only the +i and +j edges, so each pair is tested once.
      for (const { di, dj } of [DIRS[0], DIRS[2]]) {
        const x = i + di;
        const y = j + dj;
        if (x >= g.w || y >= g.h) continue;
        const b = socketAt(g, mask, x, y);
        if (!compatible(a, b)) out.push({ i, j, di, dj, a, b });
      }
    }
  }
  return out;
}

/**
 * ROAD TERMINATIONS — the real "highway that stops in mid-air".
 *
 * A lane tile is a TERMINATION when the circuit cannot continue through it:
 * every one of its neighbours is either solid or off-circuit. Riding into one
 * at speed is the moment the floor stops making sense, and it is the defect the
 * edge-socket table cannot express (see the CORRECTION above — a road's SIDES
 * are walls by definition; only its ENDS matter).
 *
 * Endpoints are exempt: the spawn and the stairs are legitimately where the
 * ride starts and stops.
 */
export function findRoadTerminations(g: Grid, mask: TrackMask, exempt: readonly TilePos[] = []): TilePos[] {
  const skip = new Set(exempt.map((p) => idx(g, p.i, p.j)));
  const out: TilePos[] = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      const k = idx(g, i, j);
      if (mask.lane[k] !== 1 || !isWalkable(g, i, j) || skip.has(k)) continue;
      let onward = 0;
      for (const { di, dj } of DIRS) {
        const x = i + di;
        const y = j + dj;
        if (isWalkable(g, x, y) && mask.lane[idx(g, x, y)] === 1) onward++;
      }
      // 0 = an isolated lane tile, 1 = the road literally ends here.
      if (onward <= 1) out.push({ i, j });
    }
  }
  return out;
}

// ── REPAIR PASSES ───────────────────────────────────────────────────────────

/**
 * UNCARVE — fill dead ends back in, cascading.
 *
 * The classic pass from Bob Nystrom's "Rooms and Mazes": a floor tile with
 * walls on three sides leads nowhere, so fill it with rock; that may turn its
 * one open neighbour into a new dead end, so repeat until the floor is stable.
 * A worklist rather than repeated full sweeps — each fill only ever creates
 * candidates among its own neighbours.
 *
 * Two rules keep this safe, and both matter:
 *  · NEVER uncarve a road tile. The circuit is the thing we are protecting; a
 *    dead-end-looking lane tile is a spur, which is deliberate.
 *  · NEVER uncarve a protected tile (spawn, stairs). Filling the stairs in
 *    would strand the run, which is the worst bug this generator can ship.
 *
 * Because it only ever turns floor→wall it can DISCONNECT things, which is why
 * it must run before the final connectivity guarantee, not after.
 */
export function uncarveDeadEnds(
  g: Grid,
  mask: TrackMask | null,
  protectedTiles: readonly TilePos[] = [],
  opts: { maxRounds?: number; maxFill?: number } = {},
): number {
  const keep = new Set(protectedTiles.map((p) => idx(g, p.i, p.j)));
  // ⚠️ BUDGET, and it is not optional. An unbounded cascade does not just trim
  // stubs — it UNRAVELS the maze. A 1-wide corridor that dead-ends has every
  // tile become a dead end the moment the one ahead of it is filled, so the
  // whole passage zips out of existence. Run unbounded, this reduced off-track
  // room floor to **1.5% of the grid**: the maze disappeared and the floor read
  // as one big track blob with nothing around it.
  //
  // Capping total fills keeps the intent (kill the short spurs that read as
  // unfinished) without the side effect (delete the districts). Expressed as a
  // fraction of open floor so it scales with floor size.
  let openCount = 0;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (isWalkable(g, i, j)) openCount++;
  const maxFill = Math.max(0, Math.round(openCount * (opts.maxFill ?? 0.12)));
  const isDeadEnd = (i: number, j: number): boolean => {
    if (!isWalkable(g, i, j)) return false;
    const k = idx(g, i, j);
    if (keep.has(k)) return false;
    if (at(g, i, j) === T_STAIRS) return false;
    if (mask && mask.lane[k] === 1) return false; // never touch the circuit
    let open = 0;
    for (const { di, dj } of DIRS) if (isWalkable(g, i + di, j + dj)) open++;
    return open <= 1;
  };

  const work: number[] = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) if (isDeadEnd(i, j)) work.push(idx(g, i, j));
  }

  let filled = 0;
  const cap = (opts.maxRounds ?? 40) * g.w * g.h;
  let guard = 0;
  while (work.length && guard++ < cap && filled < maxFill) {
    const k = work.pop()!;
    const i = k % g.w;
    const j = (k - i) / g.w;
    if (!isDeadEnd(i, j)) continue;
    setTile(g, i, j, T_WALL);
    filled++;
    // Its neighbours may have just become dead ends.
    for (const { di, dj } of DIRS) {
      const x = i + di;
      const y = j + dj;
      if (x > 0 && y > 0 && x < g.w - 1 && y < g.h - 1 && isDeadEnd(x, y)) work.push(idx(g, x, y));
    }
  }
  return filled;
}

/**
 * DE-STUB — remove wall nubs poking into open space.
 *
 * A wall tile with three or more open neighbours is a one-tile spike sticking
 * out into a room. It is not a wall in any readable sense: it reads as an
 * artefact, and at pinball speed it is worse than an eyesore because it is a
 * random deflector in the middle of a lane. Measured at 116.4 per floor before
 * this pass.
 *
 * Carving wall→floor only ever ADDS connectivity, so unlike `uncarveDeadEnds`
 * this pass is safe to run at any point. Rim tiles are exempt — those are the
 * banked shoulders of curves, and they are supposed to protrude.
 */
export function removeWallStubs(g: Grid, mask: TrackMask | null, minOpen = 3, maxRounds = 6): number {
  let total = 0;
  // ITERATE TO A FIXED POINT. One pass is not enough: opening a stub raises the
  // open-neighbour count of the walls around it, so its neighbours can become
  // stubs in turn. Measured on a real floor, a single pass took 86 stubs down
  // to 19 rather than to 0 — and the 19 survivors were exactly the ones the
  // first pass had just created.
  for (let round = 0; round < maxRounds; round++) {
    const doomed: number[] = [];
    for (let j = 1; j < g.h - 1; j++) {
      for (let i = 1; i < g.w - 1; i++) {
        if (isWalkable(g, i, j)) continue;
        if (at(g, i, j) === T_CRACKED) continue; // secret walls are deliberate
        if (g.arcIdx && g.arcIdx[idx(g, i, j)] >= 0) continue; // a curve's rim
        // A SEALED lane's wall is deliberate too — same category as a secret
        // wall, and for the same reason: it is authored, not left over. The
        // launch chute is the only sealed lane today, and opening one of its
        // side walls turns the plunger hallway into a corridor with a hole in
        // it. This pass was doing exactly that on 23/60 floors.
        if (mask && nearSealed(g, mask, i, j)) continue;
        let open = 0;
        for (const { di, dj } of DIRS) if (isWalkable(g, i + di, j + dj)) open++;
        if (open >= minOpen) doomed.push(idx(g, i, j));
      }
    }
    if (!doomed.length) break;
    // Collected first, then applied: filling as we scan would let one removal
    // change the neighbour count of a tile we haven't examined yet, so the
    // result would depend on scan order rather than on the input.
    for (const k of doomed) {
      const i = k % g.w;
      const j = (k - i) / g.w;
      setTile(g, i, j, T_FLOOR);
    }
    total += doomed.length;
  }
  return total;
}

/**
 * HEAL road terminations — a lane that ends in mid-air is either reconnected or
 * demoted.
 *
 * Two outcomes, and the choice is the whole point:
 *  · If another lane tile is within `reach`, carve the short wall run between
 *    them. The stub becomes a real shortcut, which is a gameplay gain — this is
 *    the same "open a connector to make a loop" move dungeon generators use to
 *    turn a spanning tree into something worth exploring.
 *  · Otherwise DEMOTE it: drop it from the lane mask so it is ordinary room
 *    floor. It stays walkable (nothing is stranded) but stops claiming to be
 *    track, so no booster or bank will be sited along it and it no longer reads
 *    as a highway to nowhere.
 *
 * Demotion rather than deletion matters: filling it in could disconnect the
 * floor, and this pass runs after the connectivity guarantee.
 */
export function healRoadTerminations(
  g: Grid,
  mask: TrackMask,
  exempt: readonly TilePos[] = [],
  opts: { reach?: number } = {},
): { joined: number; demoted: number } {
  const reach = opts.reach ?? 6;
  let joined = 0;
  let demoted = 0;
  // Bounded rounds: healing one termination can create another (demoting a tile
  // may leave its neighbour as the new end of the road), and we want that to
  // settle rather than run away.
  for (let round = 0; round < 8; round++) {
    const ends = findRoadTerminations(g, mask, exempt);
    if (!ends.length) break;
    for (const e of ends) {
      // Look for a lane tile to rejoin, nearest first, along a straight run.
      let best: { di: number; dj: number; d: number } | null = null;
      for (const { di, dj } of DIRS) {
        for (let d = 2; d <= reach; d++) {
          const x = e.i + di * d;
          const y = e.j + dj * d;
          if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) break;
          if (mask.lane[idx(g, x, y)] === 1 && isWalkable(g, x, y)) {
            if (!best || d < best.d) best = { di, dj, d };
            break;
          }
        }
      }
      if (best) {
        for (let d = 1; d < best.d; d++) {
          const x = e.i + best.di * d;
          const y = e.j + best.dj * d;
          setTile(g, x, y, T_FLOOR);
          mask.lane[idx(g, x, y)] = 1;
        }
        joined++;
      } else {
        mask.lane[idx(g, e.i, e.j)] = 0; // demote to plain room floor
        demoted++;
      }
    }
  }
  return { joined, demoted };
}

/**
 * How far a ball launched from (i,j) along (di,dj) travels before it hits
 * something solid. The measurement a launcher has to pass.
 */
export function clearRun(g: Grid, i: number, j: number, di: number, dj: number, max = 10): number {
  let d = 0;
  while (d < max && isWalkable(g, i + di * (d + 1), j + dj * (d + 1))) d++;
  return d;
}

/**
 * Re-aim or reject a launcher so it never fires into a wall.
 *
 * Returns the best direction with a clear run of at least `need`, or null if
 * no direction works and the part should not be placed at all. Prefers the
 * direction it was already facing — an authored facing usually encodes intent
 * (a ramp aimed down-flow), so it is only overridden when it is actually
 * broken.
 */
export function aimLauncher(
  g: Grid,
  i: number,
  j: number,
  want: { di: number; dj: number },
  need = 3,
): { di: number; dj: number } | null {
  if ((want.di || want.dj) && clearRun(g, i, j, want.di, want.dj) >= need) return want;
  let best: { di: number; dj: number } | null = null;
  let bestRun = need - 1;
  for (const { di, dj } of DIRS) {
    const run = clearRun(g, i, j, di, dj);
    if (run > bestRun) {
      bestRun = run;
      best = { di, dj };
    }
  }
  return best;
}
