/**
 * DEBUG SPAWN LAYOUT — where a scripted spawn actually puts its monsters.
 *
 * The floor already had a spawn debugger: the ` panel's enemy chips, one click
 * one monster, dropped next to the knight. That is fine for eyeballing a sprite
 * and useless for testing anything else, because almost every question worth
 * asking needs a CROWD in a KNOWN SHAPE:
 *
 *   · does Blade Storm's ring actually bite everything inside its radius?
 *   · does Time Crawl visibly smear the horde? (needs a horde)
 *   · does the Arcane Pulse wave front strike each foe as it crosses it, in
 *     distance order? (needs foes at known distances)
 *   · does an AoE stop at its edge? (needs one just inside and one just outside)
 *
 * So the layout is the part worth extracting and testing: this module is pure
 * (no three, no DOM, no game state) and answers "given a centre and a spec,
 * which WALKABLE tiles do the monsters go on". core.ts owns actually building
 * them; `__dungeonSpawn` is the harness-facing hook.
 *
 * A ring is snapped tile-by-tile rather than placed at exact polar coordinates:
 * a monster inside a wall is worse than a monster a tile off its ideal angle,
 * and a maze rarely has clean floor at every bearing.
 */
import { type Grid, type TilePos, isWalkable, worldToTile, tileCenter } from "./maze/generator";

/** How a scripted spawn arranges its monsters. */
export interface SpawnLayout {
  /** How many to place. */
  count: number;
  /**
   * Distance from the centre, in tiles. 0 (or absent) = pack them as close to
   * the centre as open floor allows — the old chip behaviour, but for N.
   * A ring is what you want for AoE work: every monster at a known range.
   */
  ring?: number;
  /** Rotate the ring, so successive calls don't stack on the same bearings. */
  phase?: number;
}

/** The ideal (unsnapped) offsets for a layout, in tiles. Exported for tests and
 *  because a caller may want to know how far it *asked* for. */
export function layoutOffsets(layout: SpawnLayout): Array<{ di: number; dj: number }> {
  const n = Math.max(0, Math.floor(layout.count));
  const r = layout.ring ?? 0;
  const phase = layout.phase ?? 0;
  const out: Array<{ di: number; dj: number }> = [];
  for (let k = 0; k < n; k++) {
    if (r <= 0) {
      out.push({ di: 0, dj: 0 }); // all at the centre; the snap fans them out
      continue;
    }
    const a = phase + (k / n) * Math.PI * 2;
    out.push({ di: Math.cos(a) * r, dj: Math.sin(a) * r });
  }
  return out;
}

/**
 * The nearest walkable tile to (ti, tj) that nothing has claimed yet, searched
 * outward in square rings. Returns null only if the whole neighbourhood within
 * `maxR` is wall or taken — i.e. there is genuinely nowhere to stand.
 *
 * `taken` is threaded through the whole layout so two monsters never land on
 * one tile, which is what makes a "ring of 8" actually read as eight.
 */
export function freeTileNear(g: Grid, ti: number, tj: number, taken: Set<number>, maxR = 6): TilePos | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (r > 0 && Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // ring shell only
        const i = ti + di;
        const j = tj + dj;
        const key = j * g.w + i;
        if (taken.has(key) || !isWalkable(g, i, j)) continue;
        taken.add(key);
        return { i, j };
      }
    }
  }
  return null;
}

/** One resolved spawn slot: the tile chosen, and the world centre of it. */
export interface SpawnPoint {
  i: number;
  j: number;
  x: number;
  z: number;
}

/**
 * How much a candidate tile may miss the requested radius before we stop
 * considering it at all. Generous, because a maze corridor genuinely may not
 * have floor at the asked-for range in most directions.
 */
const RING_SEARCH_SLACK = 4;
/**
 * Cost weights when picking a tile for a ring slot. RADIUS DOMINATES BEARING,
 * and that ordering is the whole point of this function.
 *
 * The first version snapped each slot outward from its ideal POINT, which reads
 * fine in an open room and collapses completely in a corridor: every off-axis
 * bearing is wall, so each slot walks back to the nearest floor — which is the
 * lane the knight is standing in. Asking for "8 at radius 3" returned monsters
 * at 0.0, 1.0, 1.41… i.e. standing on him. Since the reason to ask for a ring
 * is to put a horde at a KNOWN RANGE (AoE reach, wave-front ordering), losing
 * the radius loses the feature; losing some angular spread does not.
 */
const RING_W_RADIUS = 3;
const RING_W_BEARING = 1;

/** Signed shortest angular distance between two bearings, in radians. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Every walkable tile in the annulus we're willing to consider for a ring. */
function ringCandidates(g: Grid, ci: number, cj: number, r: number): Array<{ i: number; j: number; d: number; a: number }> {
  const out: Array<{ i: number; j: number; d: number; a: number }> = [];
  const reach = Math.ceil(r + RING_SEARCH_SLACK);
  for (let dj = -reach; dj <= reach; dj++) {
    for (let di = -reach; di <= reach; di++) {
      const d = Math.hypot(di, dj);
      if (Math.abs(d - r) > RING_SEARCH_SLACK) continue;
      const i = ci + di;
      const j = cj + dj;
      if (!isWalkable(g, i, j)) continue;
      out.push({ i, j, d, a: Math.atan2(dj, di) });
    }
  }
  return out;
}

/**
 * Resolve a layout around a WORLD position into distinct walkable tiles.
 *
 * Fewer points than `count` come back when the room genuinely cannot hold them
 * — the caller reports that rather than silently stacking monsters, so a test
 * that says "spawn 8" and gets 5 knows its floor was too tight instead of
 * quietly asserting against the wrong horde size.
 */
export function resolveSpawnPoints(g: Grid, cx: number, cz: number, layout: SpawnLayout): SpawnPoint[] {
  const centre = worldToTile(g, cx, cz);
  const taken = new Set<number>();
  const out: SpawnPoint[] = [];
  const r = layout.ring ?? 0;
  const push = (i: number, j: number): void => {
    const c = tileCenter(g, i, j);
    out.push({ i, j, x: c.x, z: c.z });
  };

  // No ring: pack them as tightly around the centre as open floor allows.
  if (r <= 0) {
    for (let k = 0; k < Math.max(0, Math.floor(layout.count)); k++) {
      const spot = freeTileNear(g, centre.i, centre.j, taken);
      if (spot) push(spot.i, spot.j);
    }
    return out;
  }

  // Ring: score every candidate per slot, radius first (see the weights above).
  const cand = ringCandidates(g, centre.i, centre.j, r);
  for (const off of layoutOffsets(layout)) {
    const want = Math.atan2(off.dj, off.di);
    let best: (typeof cand)[number] | null = null;
    let bestCost = Infinity;
    for (const c of cand) {
      const key = c.j * g.w + c.i;
      if (taken.has(key)) continue;
      const cost = Math.abs(c.d - r) * RING_W_RADIUS + angleDelta(c.a, want) * RING_W_BEARING;
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (!best) continue; // annulus exhausted — report short rather than stack
    taken.add(best.j * g.w + best.i);
    push(best.i, best.j);
  }
  return out;
}
