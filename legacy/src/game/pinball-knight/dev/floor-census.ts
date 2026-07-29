/**
 * A fingerprint of what `buildLevel` AUTHORED, taken the moment it finishes.
 *
 * ## Why the snapshot is taken at build time and not read live
 *
 * The first version of this computed the census on demand from `state`. It was
 * wrong, and its own negative control caught it: two runs of the *same seed*
 * disagreed on `npcs`, because the rolling-cart merchant had rolled a different
 * distance by the time each capture landed. The instrument was measuring live
 * positions — a moving quantity — and calling the difference a floor change.
 *
 * Everything interesting here moves. Zombies chase, the merchant rolls, items
 * bob, secret doors swing open and rewrite the grid. So a census read at an
 * arbitrary frame cannot answer the question it is being asked, which is
 * strictly about what the *builder* produced, not about what the world did
 * afterwards. Taking it at the end of the build makes it frame-independent by
 * construction: there is no "settle" to wait for and no timing to get wrong.
 *
 * ## What it is for
 *
 * `buildLevel` runs ~20 placement phases off ONE RNG stream. Reordering any two
 * draws changes every draw after it — a completely different floor that renders
 * fine and breaks no test. This is the gate for that: capture, refactor,
 * capture, diff. See `scripts/floor-census.mjs`.
 *
 * Cost is one pass over the grid and the entity arrays, once per floor build —
 * against a build that measures ~544 ms. It is not gated behind a flag on
 * purpose: a diagnostic that is off in the environment you care about is its
 * own trap.
 */
import { state } from "../state";

export interface FloorCensus {
  level: number;
  runSeed: number;
  grid: { w: number; h: number; tiles: number; shapes: number; surfaces: number | null; arcs: number } | null;
  walkable: number;
  stairs: { i: number; j: number } | null;
  start: { x: number; z: number };
  hordeSize: number;
  zombies: { n: number; byKind: Record<string, number>; sum: number };
  parts: { n: number; byKind: Record<string, number>; sum: number };
  items: { n: number; sum: number };
  npcs: { n: number; sum: number };
  props: number;
  doorways: number;
  rooms: number;
  /** Scene-graph descendants, and how many of them are drawable meshes. */
  sceneObjects: number;
  sceneMeshes: number;
}

let last: FloorCensus | null = null;

/** Quantize before folding — float noise across a JIT warm-up is not a change. */
const q = (n: number): number => Math.round(n * 1e4);

/**
 * FNV-1a over the fields, folded IN ARRAY ORDER.
 *
 * ⚠️ Array order is the signal, not a detail: it is the order the RNG drew
 * these entities in. A census that sorted first would still match after a
 * reordering and would certify exactly the bug this exists to catch. Counts
 * alone are just as weak — two phases swapping their draws usually leaves every
 * total identical.
 */
function fold(parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === "number" ? String(q(p)) : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c; // a separator, so ["ab","c"] and ["a","bc"] differ
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Snapshot the floor. Call at the END of the level build, after every phase has
 * placed what it places and before the player has had a frame to disturb it.
 */
/** Walk the scene once and count what the renderer will have to walk per frame. */
function countScene(): { sceneObjects: number; sceneMeshes: number } {
  let sceneObjects = 0;
  let sceneMeshes = 0;
  state.scene?.traverse((o) => {
    sceneObjects++;
    if ((o as { isMesh?: boolean }).isMesh) sceneMeshes++;
  });
  return { sceneObjects, sceneMeshes };
}

export function captureFloorCensus(): void {
  const g = state.grid;
  const byKind: Record<string, number> = {};
  for (const z of state.zombies) byKind[z.kind] = (byKind[z.kind] ?? 0) + 1;
  const partsByKind: Record<string, number> = {};
  for (const p of state.pinballParts) partsByKind[p.kind] = (partsByKind[p.kind] ?? 0) + 1;
  last = {
    level: state.level,
    runSeed: state.runSeed,
    // Tiles, SHAPES and SURFACES fold separately: a floor can keep an identical
    // walkable footprint while the shape or surface pass moved, and both run
    // late in the build where a reorder is most likely to hide.
    grid: g
      ? {
          w: g.w,
          h: g.h,
          tiles: fold(Array.from(g.t)),
          shapes: fold(Array.from(g.shapes)),
          surfaces: g.surfaces ? fold(Array.from(g.surfaces)) : null,
          arcs: g.arcs?.length ?? 0,
        }
      : null,
    walkable: g ? g.t.reduce((n: number, t: number) => n + (t !== 0 ? 1 : 0), 0) : 0,
    stairs: state.stairs ? { i: state.stairs.i, j: state.stairs.j } : null,
    start: { x: q(state.levelStart.x), z: q(state.levelStart.z) },
    hordeSize: state.levelHordeSize,
    zombies: { n: state.zombies.length, byKind, sum: fold(state.zombies.flatMap((z) => [z.kind, z.x, z.z, z.hp])) },
    parts: { n: state.pinballParts.length, byKind: partsByKind, sum: fold(state.pinballParts.flatMap((p) => [p.kind, p.x, p.z])) },
    items: { n: state.groundItems.length, sum: fold(state.groundItems.flatMap((it) => [String(it.kind ?? ""), it.x, it.z])) },
    npcs: { n: state.npcs.length, sum: fold(state.npcs.flatMap((n) => [n.kind, n.x, n.z])) },
    // The CPU walks EVERY descendant each frame to cull and sort, so this — not
    // the draw-call count — is what per-frame submission cost scales with. The
    // logical counts above hide it: one pinball "part" is a Group of 3-13
    // meshes, so 99 parts is well over a thousand objects.
    ...countScene(),
    props: state.props?.length ?? 0,
    doorways: state.doorways?.length ?? 0,
    rooms: state.levelRooms?.length ?? 0,
  };
}

/** The census of the floor most recently built, or null before the first build. */
export function lastFloorCensus(): FloorCensus | null {
  return last;
}
