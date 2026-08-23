/**
 * DOORWAYS — the canonical opening between two sections of a floor.
 *
 * ── The complaint this answers ────────────────────────────────────────────
 *
 *   "we need to make sure we don't have narrow exits because they are being
 *    generated in the maze generator system and it looks bad/looks sloppy. It
 *    should have clear doorways, entrances from one place to another … it
 *    should be a uniform size, and we have different uniform sizes that can go
 *    from one section to another"
 *
 * Read as a VOCABULARY, not a minimum. A minimum turns a 1-tile squeeze into a
 * 3-tile one and leaves every other opening at whatever width the maze happened
 * to leave, so the floor still reads as accidental. What makes an opening look
 * authored is being recognisably THE SAME OBJECT each time you meet it — hence
 * `DOORWAY_WIDTHS`, three sizes, odd on purpose so an opening has a true centre
 * tile and can be centred on its passage's own axis.
 *
 * ── The measurement that shaped it (DOORWAY_PLAN.md §1) ───────────────────
 *
 * Passage width is measured on the MEDIAL AXIS: the widest circle that fits at
 * the pinch. An arbitrary tile's wall clearance is NOT width — every tile of a
 * 2-wide corridor touches a wall exactly like a 1-wide one does. Over 120
 * generated floors, 81.3% of pinches were a single tile wide, leaving 0.20 of
 * slack per side for a ball of radius 0.3 at 22 u/s: it cannot cross without
 * touching both walls, which is the reported rattle.
 *
 * ── Why sections are labelled ONCE, before any carving ────────────────────
 *
 * The first attempt decided what counted as a "room" from local clearance,
 * re-derived on every pass. That is SELF-AMPLIFYING: widening an opening
 * promotes the corridor beyond it into a room, which manufactures a fresh
 * doorway, which widens again — measured, 34 → 107 doorways per floor while the
 * pinches it was supposed to remove barely moved (109 → 102). It is the exact
 * opposite of `removeWallStubs`, where every round strictly reduces the work
 * left, and the "iterate to a fixed point" reflex is wrong here.
 *
 * So: label sections once, from the clearance field, before anything is carved.
 * A doorway is then *"the opening between section 3 and section 7"* — a
 * statement carving cannot invalidate.
 *
 * ── Siting ────────────────────────────────────────────────────────────────
 *
 * A multi-source BFS out of every section at once — a Voronoi partition of
 * corridor space. Where two territories meet, those sections are connected.
 *
 * ONE DOOR PER CONNECTION, and the distinction from "one per PAIR" is measured
 * rather than argued. Per pair was the design DOORWAY_PLAN §3 wrote down, and
 * on the shipping generator it is a no-op: the widest meeting tile of a pair is
 * already 3+ tiles across on 93% of pairs, so the door gets recorded where
 * nothing needed doing while every actual squeeze between the same two sections
 * keeps its 1-tile slot. 1181 doorways over 78 floors carved 5.6 tiles of stone
 * per floor between them. Grouping the boundary into connected strips instead
 * makes a doorway name a ROUTE, which is the thing a player walks through.
 *
 * ── A doorway is an opening in a WALL ─────────────────────────────────────
 *
 * Two filters do most of the work of keeping that true, and both come from
 * measurement rather than from the plan:
 *
 *  · a seam WIDER than the vocabulary gets no door. Two sections that meet
 *    across a 12-tile front have not got a threshold between them, they have
 *    merged, and cutting a "doorway" there authors an object in the middle of a
 *    field. 36% of seams are like this.
 *  · a cut that would leave no JAMB is refused (`jambsSurvive`). Widening a
 *    1-tile slot whose neighbouring tile is a lone pillar breaks sideways into
 *    whatever is behind it, and `removeWallStubs` then eats the rest of a thin
 *    partition. Before this check 17% of doorways finished wider than the size
 *    they were authored at, the worst at 52 tiles; after it, 1.3%.
 *
 * ── What is never carved ──────────────────────────────────────────────────
 *
 * Only ever wall → floor, so a doorway can never strand anything and needs no
 * repair pass behind it. On top of that the carve declines:
 *
 *  · the outermost ring of the grid (the border must stay solid);
 *  · a `mask.sealed` tile or its side walls — the launch chute's whole value is
 *    that it commits you, and a plunger hallway with a hole in the side is a
 *    worse defect than a narrow exit (`track-launch.test.ts` catches it);
 *  · a `T_CRACKED` tile — that is a deliberate hidden route, and announcing it
 *    is the opposite of a secret;
 *  · anything under an arc feature's DRAWN SPAN (see `arcSpanMask`).
 *
 * That last one is what sank the second attempt and it is worth stating
 * precisely, because the obvious guard is the wrong one. `publishArcs` claims
 * only tiles that are `T_WALL` at stamp time, so it never publishes over open
 * floor — but `arcSweepGeometry` DRAWS the whole `a0 … a0 + span` band without
 * consulting the grid. A doorway carved anywhere under that band un-backs the
 * drawn geometry even though the feature never claimed those tiles. A 3×3
 * neighbourhood guard around `arcIdx` checks OWNERSHIP; the requirement is
 * about the SPAN.
 *
 * DOM- and three-free, and no rng: two co-op peers must plan the same doors.
 */
import {
  type Grid,
  type TilePos,
  at,
  idx,
  isWalkable,
  setTile,
  shapeAt,
  T_CRACKED,
  T_FLOOR,
  T_WALL,
} from "./generator";
import { SHAPE_ARC, SHAPE_FULL } from "../engine/tile-shape";
import { backedAt } from "./arc-contract";
import { nearSealed } from "./track-socket";
import type { TrackMask } from "./track-carve";

/**
 * The vocabulary. ODD on purpose: an even opening has no centre tile, so it
 * cannot be centred on its passage's axis and every instance lands half a tile
 * off in a direction the maze chose rather than one we did.
 *
 * Widest first, because `DOORWAY_WIDTHS[0]` is also the answer to "how wide can
 * an opening be and still be a doorway at all". `resolveDoorway` walks it the
 * other way, taking the SMALLEST member that clears both the size the sections
 * earned and the width the opening already has — so a 4-tile gap becomes a
 * 5-tile doorway rather than being left as a 4-tile gap.
 */
export const DOORWAY_WIDTHS: readonly number[] = [7, 5, 3];

/** The narrowest opening this module will ever author. Also what the gate asserts. */
export const MIN_DOORWAY_WIDTH = 3;

/**
 * Clearance, in tiles, at which floor stops being a corridor and starts being a
 * SPACE. 3 means "a circle of radius 3 fits", i.e. a passage 5 tiles across —
 * the same 5+ threshold §1 used to define a section-gating pinch.
 */
export const SECTION_CLEARANCE = 3;

/**
 * Tiles a component needs before it counts as a section. A 5-wide bulge two
 * tiles long is not a place you go between; it is a corridor having a moment.
 * Sized just under a 4×4 room so a genuinely small chamber still qualifies.
 */
export const MIN_SECTION_TILES = 14;

/**
 * How far along the travel axis a doorway may reach before it stops being a
 * doorway and becomes a widened corridor.
 *
 * The throat is carved outward until the full-width cross-section is ALREADY
 * open on both sides — that is what makes a doorway a threshold between two
 * spaces rather than a bulge in the middle of a passage, and it is also what
 * guarantees the carve creates no dead ends: every column of the opening ends
 * on open floor at both ends by construction. A pinch that needs more than this
 * to reach daylight is a corridor, and widening corridors wholesale is how the
 * first attempt carved the maze open.
 */
export const MAX_DOORWAY_DEPTH = 4;

/** How far the centre may slide along its own axis to find a clear placement. */
const MAX_SLIDE = 3;

/**
 * Section size at which a pair earns each vocabulary size, in floor tiles of
 * the SMALLER of the two sections.
 *
 * Size from what it JOINS, never an rng roll — that is what makes the width
 * carry information a player can learn ("this is the mouth of somewhere big")
 * instead of being noise. The smaller section decides, because an opening reads
 * as belonging to the more modest of the two rooms it serves.
 */
export const DOORWAY_TIERS: ReadonlyArray<{ minTiles: number; width: number }> = [
  { minTiles: 220, width: 7 },
  { minTiles: 90, width: 5 },
  { minTiles: 0, width: 3 },
];

/** Chamfer weights — (3,4)/3 approximates Euclidean distance to within ~6%. */
const ORTH = 3;
const DIAG = 4;

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Distance from every walkable tile to the nearest solid one, ×3.
 *
 * A 3-4 chamfer rather than a plain BFS: the quantity wanted is the radius of
 * the largest circle that fits, and 4-connected BFS measures a diamond while
 * 8-connected measures a square. Either would report a 1-wide diagonal slot as
 * roomy. Wall tiles read 0; a floor tile against a wall reads 3 (one tile).
 */
export function clearanceField(g: Grid): Int32Array {
  const BIG = 1 << 28;
  const d = new Int32Array(g.w * g.h);
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) d[idx(g, i, j)] = isWalkable(g, i, j) ? BIG : 0;
  }
  const relax = (k: number, from: number, cost: number): void => {
    const v = d[from] + cost;
    if (v < d[k]) d[k] = v;
  };
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (d[k] === 0) continue;
      if (i > 0) relax(k, k - 1, ORTH);
      if (j > 0) relax(k, k - g.w, ORTH);
      if (i > 0 && j > 0) relax(k, k - g.w - 1, DIAG);
      if (i < g.w - 1 && j > 0) relax(k, k - g.w + 1, DIAG);
    }
  }
  for (let j = g.h - 1; j >= 0; j--) {
    for (let i = g.w - 1; i >= 0; i--) {
      const k = idx(g, i, j);
      if (d[k] === 0) continue;
      if (i < g.w - 1) relax(k, k + 1, ORTH);
      if (j < g.h - 1) relax(k, k + g.w, ORTH);
      if (i < g.w - 1 && j < g.h - 1) relax(k, k + g.w + 1, DIAG);
      if (i > 0 && j < g.h - 1) relax(k, k + g.w - 1, DIAG);
    }
  }
  return d;
}

/** Passage width, in tiles, implied by a clearance reading. */
export function widthFromClearance(c3: number): number {
  return Math.max(1, 2 * Math.floor(c3 / ORTH) - 1);
}

export interface SectionMap {
  /** Section id per tile, −1 where the tile belongs to no section. */
  label: Int32Array;
  /** Floor tiles in each section, indexed by id. */
  sizes: number[];
}

/**
 * Connected components of tiles that are genuinely SPACES, labelled once.
 *
 * Everything downstream refers to sections by id, never by re-deriving "is this
 * a room" from the grid — see the self-amplification note in the header.
 */
export function labelSections(g: Grid, cl: Int32Array, clearance = SECTION_CLEARANCE): SectionMap {
  const label = new Int32Array(g.w * g.h).fill(-1);
  const sizes: number[] = [];
  const min = clearance * ORTH;
  const stack: number[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k0 = idx(g, i, j);
      if (label[k0] >= 0 || cl[k0] < min) continue;
      const id = sizes.length;
      let n = 0;
      stack.length = 0;
      stack.push(k0);
      label[k0] = id;
      while (stack.length) {
        const k = stack.pop()!;
        n++;
        const x = k % g.w;
        const y = (k - x) / g.w;
        for (const [di, dj] of SIDES) {
          const nx = x + di;
          const ny = y + dj;
          if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
          const nk = idx(g, nx, ny);
          if (label[nk] >= 0 || cl[nk] < min) continue;
          label[nk] = id;
          stack.push(nk);
        }
      }
      sizes.push(n);
    }
  }
  // Drop components too small to be a place. Relabelled rather than merely
  // filtered so `label` stays a usable index into `sizes` everywhere.
  const remap = new Int32Array(sizes.length).fill(-1);
  const kept: number[] = [];
  for (let s = 0; s < sizes.length; s++) {
    if (sizes[s] >= MIN_SECTION_TILES) {
      remap[s] = kept.length;
      kept.push(sizes[s]);
    }
  }
  for (let k = 0; k < label.length; k++) {
    if (label[k] >= 0) label[k] = remap[label[k]];
  }
  return { label, sizes: kept };
}

/**
 * Which section owns each walkable tile, by multi-source BFS out of all of them
 * at once — a Voronoi partition of corridor space.
 *
 * Ties break by scan order, which is deterministic and therefore identical on
 * every co-op peer. That matters more than which side wins.
 */
export function sectionTerritory(g: Grid, sec: SectionMap): Int32Array {
  const owner = new Int32Array(g.w * g.h).fill(-1);
  const queue: number[] = [];
  for (let k = 0; k < owner.length; k++) {
    if (sec.label[k] >= 0) {
      owner[k] = sec.label[k];
      queue.push(k);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % g.w;
    const y = (k - x) / g.w;
    for (const [di, dj] of SIDES) {
      const nx = x + di;
      const ny = y + dj;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const nk = idx(g, nx, ny);
      if (owner[nk] >= 0 || !isWalkable(g, nx, ny)) continue;
      owner[nk] = owner[k];
      queue.push(nk);
    }
  }
  return owner;
}

/** A planned opening: where it goes, which two sections it joins, how wide it wants to be. */
export interface DoorwaySite {
  /** Centre tile of the opening. */
  i: number;
  j: number;
  /** Unit vector ALONG the passage — the direction you travel through the door. */
  ai: number;
  aj: number;
  /** Unit vector ACROSS the passage — the axis the width is measured on. */
  wi: number;
  wj: number;
  /** Vocabulary size this pair earned from the sections it joins. */
  want: number;
  /** The two sections, ascending. */
  a: number;
  b: number;
}

/** A doorway resolved against a real grid: the size and depth actually opened. */
export interface Doorway extends DoorwaySite {
  /** Vocabulary size actually authored — `want`, or a step down it if that would not fit. */
  w: number;
  /** Cross-sections opened behind and ahead of the centre along the travel axis. */
  back: number;
  fwd: number;
  /** Wall tiles converted to floor. Zero when the opening was already wide enough. */
  carved: number;
}

/** Length of the contiguous open run through (i,j) along (di,dj), including the tile itself. */
function openRun(g: Grid, i: number, j: number, di: number, dj: number): number {
  if (!isWalkable(g, i, j)) return 0;
  let n = 1;
  for (let s = 1; ; s++) {
    if (!isWalkable(g, i + di * s, j + dj * s)) break;
    n++;
  }
  for (let s = 1; ; s++) {
    if (!isWalkable(g, i - di * s, j - dj * s)) break;
    n++;
  }
  return n;
}

/**
 * Plan one doorway per pair of sections that touch.
 *
 * Nothing is carved and nothing about the grid is assumed to survive: the
 * result names SECTIONS and a site, and `carveDoorways` re-resolves the size
 * and depth against whatever grid it is finally handed. That split is the point
 * of planning early — see the header.
 */
export function planDoorways(
  g: Grid,
  opts: { cl?: Int32Array; clearance?: number; perConnection?: boolean } = {},
): DoorwaySite[] {
  const cl = opts.cl ?? clearanceField(g);
  const sec = labelSections(g, cl, opts.clearance);
  if (sec.sizes.length < 2) return [];
  const owner = sectionTerritory(g, sec);

  // ── ONE DOOR PER CONNECTION, not per pair ────────────────────────────────
  //
  // The territory boundary between two sections is not one place: two sections
  // joined by three corridors meet in three disconnected strips. Grouping the
  // boundary into COMPONENTS is what makes "the opening between 3 and 7" name a
  // route rather than a set of them.
  //
  // Per PAIR was the first design, and measured it is a no-op: the widest
  // meeting tile of a pair is already 3+ tiles across on 93% of pairs, so the
  // door is recorded where nothing needed doing and every actual squeeze
  // between the same two sections keeps its 1-tile slot. 1181 doorways over 78
  // floors carved 5.6 tiles per floor between them.
  const boundary: number[] = [];
  const pairOf = new Int32Array(g.w * g.h).fill(-1);
  const P = sec.sizes.length;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      const oa = owner[k];
      if (oa < 0) continue;
      for (const [di, dj] of SIDES) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
        const ob = owner[idx(g, x, y)];
        if (ob < 0 || ob === oa) continue;
        pairOf[k] = oa < ob ? oa * P + ob : ob * P + oa;
        boundary.push(k);
        break;
      }
    }
  }

  // Flood each boundary strip 8-connected: a diagonal step still walks the same
  // seam, and treating a staircase-shaped meeting line as two connections would
  // author two doors a tile apart.
  //
  // ── WHERE ON THE SEAM THE DOOR GOES ──────────────────────────────────────
  //
  // At the seam's NARROWEST CROSS-SECTION, and this is the one place the plan's
  // §3 rationale ("the meeting tile with the greatest clearance … is already
  // the widest part of that connection") is simply wrong when read tile-by-tile
  // rather than connection-by-connection. Two rooms separated by a wall with a
  // one-tile slot in it meet across exactly two tiles: the slot, and the room
  // tile beyond it. The room tile has the greater clearance — so the widest-tile
  // rule sites the door one tile PAST the squeeze, inside the room, where it
  // measures nineteen tiles across and is discarded as "these two have merged".
  // The squeeze it existed to remove is untouched. Pinned in doorways.test.ts.
  //
  // Cross-section rather than clearance, because clearance also falls off near
  // the walls at the ENDS of a perfectly good wide opening: minimising it would
  // site the door in the corner of a 15-tile mouth. The open run across the
  // passage is the same everywhere along one opening, which is exactly the
  // property wanted — it identifies the opening, not a spot on it.
  const seen = new Uint8Array(g.w * g.h);
  const best = new Map<number, { k: number; key: number; cross: number }>();
  const stack: number[] = [];
  let comp = 0;
  for (const start of boundary) {
    if (seen[start]) continue;
    const key = pairOf[start];
    const id = comp++;
    let bestK = -1;
    let bestCross = Infinity;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % g.w;
      const y = (k - x) / g.w;
      const c = crossWidth(g, x, y);
      // Ties break on the lower tile index, which is a scan-order fact and so
      // identical on every co-op peer. That matters more than which tile wins.
      if (c < bestCross || (c === bestCross && k < bestK)) {
        bestCross = c;
        bestK = k;
      }
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const nx = x + di;
          const ny = y + dj;
          if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
          const nk = idx(g, nx, ny);
          if (seen[nk] || pairOf[nk] !== key) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    if (bestK < 0) continue;
    // `perConnection` off collapses the components back to one door per pair —
    // kept so the two policies can be censused against each other on the same
    // floors rather than argued about.
    const slot = opts.perConnection === false ? key : id * P * P + key;
    const prev = best.get(slot);
    if (!prev || bestCross > prev.cross) best.set(slot, { k: bestK, key, cross: bestCross });
  }

  const sites: DoorwaySite[] = [];
  for (const [, m] of [...best.entries()].sort((p, q) => p[1].k - q[1].k)) {
    const a = Math.floor(m.key / P);
    const b = m.key % P;
    const i = m.k % g.w;
    const j = (m.k - i) / g.w;
    // WHICH AXIS IS THE WIDTH? The narrower open run, measured on the grid —
    // not the direction the BFS happened to cross. A passage that runs
    // diagonally has no true axis, and picking the crossing direction there
    // would cut the doorway at 45° to the wall it is a hole in.
    const widthIsH = openRun(g, i, j, 1, 0) <= openRun(g, i, j, 0, 1);
    sites.push({
      i,
      j,
      ai: widthIsH ? 0 : 1,
      aj: widthIsH ? 1 : 0,
      wi: widthIsH ? 1 : 0,
      wj: widthIsH ? 0 : 1,
      want: doorwayWidthFor(Math.min(sec.sizes[a], sec.sizes[b])),
      a,
      b,
    });
  }
  return sites;
}

/** The open run across the passage at (i,j) — its width on the narrower axis. */
function crossWidth(g: Grid, i: number, j: number): number {
  return Math.min(openRun(g, i, j, 1, 0), openRun(g, i, j, 0, 1));
}

/** The vocabulary size a pair earns, from the smaller of the two sections. */
export function doorwayWidthFor(minSectionTiles: number): number {
  for (const t of DOORWAY_TIERS) if (minSectionTiles >= t.minTiles) return t.width;
  return MIN_DOORWAY_WIDTH;
}

/**
 * How wide the opening at a planned site is TODAY, across the passage.
 *
 * This is the number that decides whether a site is a doorway at all. A seam
 * that runs through open ground — two sections that simply merge rather than
 * meeting at an opening — measures far wider than the vocabulary, and gets no
 * door: there is no threshold there to make uniform. Measured on the finished
 * floors, that is most of the seams the Voronoi partition finds, and filtering
 * on it is what stops the pass from authoring "doorways" in the middle of a
 * field.
 */
export function siteWidth(g: Grid, site: DoorwaySite): number {
  return openRun(g, site.i, site.j, site.wi, site.wj);
}

/** Everything `carveDoorways` needs to know about what it must not open. */
export interface CarveGuards {
  mask?: TrackMask | null;
  /** Tiles under an arc feature's drawn span — see `arcSpanMask`. */
  spanMask?: Uint8Array | null;
}

/**
 * Why a tile could not be opened — named rather than boolean so the census can
 * say which guard is doing the rejecting.
 *
 * That distinction is the acceptance criterion for the arc-span guard
 * (DOORWAY_PLAN §5 Step A): the guard ships only if it is not the thing
 * rejecting the doorways, and a plain "blocked" count cannot tell you that.
 */
export type TileVerdict = "open" | "carvable" | "border" | "secret" | "bevel" | "arc" | "span" | "sealed";

/** May this tile be opened, or is it already open? */
function tileState(g: Grid, x: number, y: number, guards: CarveGuards): TileVerdict {
  // The outermost ring is the floor's shell. `carveDoorways` refuses to touch
  // it, so a centre sited one tile in would silently come out narrower — which
  // is why the caller slides the centre rather than clipping the opening.
  if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) return "border";
  if (isWalkable(g, x, y)) return "open";
  if (at(g, x, y) !== T_WALL) return "secret"; // T_CRACKED is a deliberate hidden route
  if (shapeAt(g, x, y) === SHAPE_ARC) return "arc";
  if (shapeAt(g, x, y) !== SHAPE_FULL) return "bevel";
  const k = idx(g, x, y);
  if (guards.spanMask?.[k]) return "span";
  if (guards.mask && nearSealed(g, guards.mask, x, y)) return "sealed";
  return "carvable";
}

/**
 * Would the wall on either side of this opening still be a wall afterwards?
 *
 * ── The interaction that makes this necessary ─────────────────────────────
 *
 * `removeWallStubs` runs after the carve and deletes any wall tile with three
 * or more open orthogonal neighbours. Cut a 3-wide hole through a wall that is
 * ONE tile thick and each remaining tile of that wall acquires exactly that: the
 * new opening on one side, and the two rooms it separated on the others. The
 * stub sweep then eats the whole wall, iterating to a fixed point — so the
 * "doorway" ends up as the entire wall's absence.
 *
 * Measured before this check: 15% of authored doorways finished wider than the
 * size they were authored at, the worst at **52 tiles**, which is not a doorway
 * being slightly generous, it is a wall that dissolved.
 *
 * So a doorway is only authored where it leaves a wall behind. A thin partition
 * between two spaces is not a place a threshold can exist — declining there is
 * the honest answer, and the two sections simply stay joined by the opening the
 * maze already gave them.
 */
function jambsSurvive(
  g: Grid,
  site: DoorwaySite,
  ci: number,
  cj: number,
  w: number,
  back: number,
  fwd: number,
): boolean {
  const half = (w - 1) / 2;
  const cut = new Set<number>();
  for (let t = -back; t <= fwd; t++) {
    for (let o = -half; o <= half; o++) {
      cut.add(idx(g, ci + site.ai * t + site.wi * o, cj + site.aj * t + site.wj * o));
    }
  }
  const openAfter = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
    return isWalkable(g, x, y) || cut.has(idx(g, x, y));
  };
  for (const o of [-(half + 1), half + 1]) {
    for (let t = -back; t <= fwd; t++) {
      const x = ci + site.ai * t + site.wi * o;
      const y = cj + site.aj * t + site.wj * o;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      if (isWalkable(g, x, y)) return false; // no jamb here — the cut would break sideways
      let open = 0;
      for (const [di, dj] of SIDES) if (openAfter(x + di, y + dj)) open++;
      if (open >= 3) return false; // the stub sweep would eat this jamb
    }
  }
  return true;
}

/**
 * Resolve a planned site into a concrete doorway on THIS grid, or null.
 *
 * The throat grows outward along the travel axis until the full-width
 * cross-section is already open on both sides. That rule does three jobs at
 * once: it makes the doorway a threshold between two spaces rather than a bulge
 * in a corridor; it bounds the carve; and it guarantees no dead ends, because
 * every column of the opening then ends on open floor at both ends.
 *
 * When the smallest qualifying size will not fit, the next one UP is tried
 * rather than the opening being clipped to whatever the grid allowed — a 4-wide
 * opening is not a member of the vocabulary and would read as another accident.
 */
export function resolveDoorway(
  g: Grid,
  site: DoorwaySite,
  guards: CarveGuards = {},
  out?: { reason: string },
): Doorway | null {
  const cur = siteWidth(g, site);
  if (out) out.reason = "merged";
  if (cur > DOORWAY_WIDTHS[0]) return null; // wider than the vocabulary — not a doorway
  if (out) out.reason = "throat";
  for (const w of [...DOORWAY_WIDTHS].reverse()) {
    // ROUND UP TO THE VOCABULARY, do not merely clear a minimum. §3's whole
    // argument is that a minimum leaves every other opening at whatever width
    // the maze happened to leave, so the floor still reads as accidental — a
    // 4-tile gap is not a doorway, it is an absence of wall. The size a pair
    // EARNED (`want`) is the floor; the opening's current width raises it to
    // the next member up. Both are only ever widened, so this stays a
    // wall → floor pass and can strand nothing.
    if (w < Math.max(site.want, cur)) continue;
    const half = (w - 1) / 2;
    for (let s = 0; s <= MAX_SLIDE * 2; s++) {
      // 0, −1, +1, −2, +2 … — the unslid placement is always tried first, so a
      // site that already works keeps exactly the centre the plan chose.
      const shift = s === 0 ? 0 : (s % 2 === 1 ? -1 : 1) * Math.ceil(s / 2);
      if (Math.abs(shift) > MAX_SLIDE) continue;
      const ci = site.i + site.wi * shift;
      const cj = site.j + site.wj * shift;
      const cross = (t: number): TileVerdict => {
        let any = false;
        for (let o = -half; o <= half; o++) {
          const x = ci + site.ai * t + site.wi * o;
          const y = cj + site.aj * t + site.wj * o;
          const st = tileState(g, x, y, guards);
          if (st !== "open" && st !== "carvable") {
            if (out) out.reason = st;
            return st;
          }
          if (st === "carvable") any = true;
        }
        return any ? "carvable" : "open";
      };
      const centre = cross(0);
      if (centre !== "open" && centre !== "carvable") continue;
      // Already `w` tiles across at the site: the opening exists, and the plan
      // records it so the gate still watches it. Carving nothing is the right
      // answer roughly a third of the time and is why the authored count is
      // stable at ~32 while only ~11 pinches per floor actually gate a section.
      // ⚠️ The SLID centre is what the doorway records, not the planned one.
      // Returning `site` here ships a doorway whose footprint is measured from
      // a tile the carve never used — the audit then reads a different opening
      // from the one that was cut.
      if (centre === "open") return { ...site, i: ci, j: cj, w, back: 0, fwd: 0, carved: 0 };
      const reach = (dir: number): number | null => {
        for (let t = dir; Math.abs(t) <= MAX_DOORWAY_DEPTH; t += dir) {
          const st = cross(t);
          if (st === "open") return Math.abs(t) - 1;
          if (st !== "carvable") return null;
        }
        if (out) out.reason = "throat";
        return null;
      };
      const back = reach(-1);
      const fwd = reach(1);
      if (back === null || fwd === null) continue;
      if (!jambsSurvive(g, site, ci, cj, w, back, fwd)) {
        if (out) out.reason = "jamb";
        continue;
      }
      return { ...site, i: ci, j: cj, w, back, fwd, carved: 0 };
    }
  }
  return null;
}

/** Every tile a doorway occupies, opened or already open. */
export function doorwayFootprint(g: Grid, d: Doorway): TilePos[] {
  const out: TilePos[] = [];
  const half = (d.w - 1) / 2;
  for (let t = -d.back; t <= d.fwd; t++) {
    for (let o = -half; o <= half; o++) {
      out.push({ i: d.i + d.ai * t + d.wi * o, j: d.j + d.aj * t + d.wj * o });
    }
  }
  return out;
}

/**
 * Open the planned doorways on `g`, and return the ones that survived.
 *
 * WALL → FLOOR ONLY, so this pass cannot strand anything and needs no repair
 * behind it. It does raise the open-neighbour count of the walls beside each
 * opening, so `removeWallStubs` must run AFTER it.
 *
 * `blocked` counts the planned sites that could not be resolved at all — that
 * is the number the arc-span guard is judged on (DOORWAY_PLAN §5 Step A: if it
 * rejects more than 15% of planned doorways, the guard is too blunt and the arc
 * spans themselves need clipping instead).
 */
export function carveDoorways(
  g: Grid,
  sites: readonly DoorwaySite[],
  guards: CarveGuards = {},
): { doorways: Doorway[]; blocked: number; merged: number; rejects: Record<string, number> } {
  const doorways: Doorway[] = [];
  const rejects: Record<string, number> = {};
  let blocked = 0;
  let merged = 0;
  const out = { reason: "" };
  for (const site of sites) {
    const d = resolveDoorway(g, site, guards, out);
    if (!d) {
      rejects[out.reason] = (rejects[out.reason] ?? 0) + 1;
      // Two different things, and conflating them would hide the number the
      // arc-span guard is judged on: `merged` is a seam with no threshold to
      // author, `blocked` is a threshold something refused to let us cut.
      if (out.reason === "merged") merged++;
      else blocked++;
      continue;
    }
    let carved = 0;
    for (const t of doorwayFootprint(g, d)) {
      if (isWalkable(g, t.i, t.j)) continue;
      setTile(g, t.i, t.j, T_FLOOR);
      carved++;
    }
    doorways.push({ ...d, carved });
  }
  return { doorways, blocked, merged, rejects };
}

/**
 * Tiles that must stay solid because an arc feature is DRAWN over them.
 *
 * The subtlety that sank the second attempt: `publishArcs` claims only tiles
 * that are `T_WALL` at stamp time, so ownership is never the problem — but
 * `arcSweepGeometry` draws the whole `a0 … a0 + span` band regardless of which
 * tiles reference the feature, and `piece-rules` then asserts that every
 * sampled point of that band has stone behind it. So the guard has to mirror
 * what the ASSERTION samples, not what the feature owns.
 *
 * `backedAt` is that sample, and this walks it at four times the density
 * `backedFraction` uses so the marked set is a strict superset of the tiles the
 * gate will probe.
 */
export function arcSpanMask(g: Grid): Uint8Array {
  const mask = new Uint8Array(g.w * g.h);
  const BACK_PROBE = 0.6; // must match arc-contract.BACK_PROBE
  for (const f of g.arcs ?? []) {
    const rr = f.solidOut ? f.r + BACK_PROBE : f.r - BACK_PROBE;
    if (rr <= 0) continue;
    const n = Math.max(16, Math.ceil(f.r * f.span * 12));
    for (let s = 0; s <= n; s++) {
      const ang = f.a0 + (f.span * s) / n;
      const i = Math.floor(f.cx + Math.cos(ang) * rr);
      const j = Math.floor(f.cz + Math.sin(ang) * rr);
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      mask[idx(g, i, j)] = 1;
    }
  }
  return mask;
}

/**
 * The finished width of an authored doorway, in tiles.
 *
 * ⚠️ Measured through the AUTHORED centre, never re-derived from the final
 * floor. Re-detecting pinches on the finished grid returns only the openings
 * that were NOT fixed — a widened doorway is no longer a pinch — and then
 * measures a run that has merged into the space beyond it. An early version
 * reported an opening as "9 wide" for exactly that reason and failed 78 floors
 * out of 78 on a meaningless metric.
 *
 * The narrowest cross-section over the doorway's own depth, because that is
 * what the ball has to fit through.
 */
export function measureDoorway(g: Grid, d: Doorway): number {
  let worst = Infinity;
  for (let t = -d.back; t <= d.fwd; t++) {
    const i = d.i + d.ai * t;
    const j = d.j + d.aj * t;
    worst = Math.min(worst, openRun(g, i, j, d.wi, d.wj));
  }
  return worst === Infinity ? 0 : worst;
}

/** Census helper: how many doorways of each vocabulary size a floor has. */
export function doorwayCensus(doorways: readonly Doorway[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const d of doorways) out[d.w] = (out[d.w] ?? 0) + 1;
  return out;
}

/** Every pinch on the floor that gates a section — the set doorways exist to fix. */
export function sectionPinches(g: Grid, cl?: Int32Array): TilePos[] {
  const c = cl ?? clearanceField(g);
  const sec = labelSections(g, c);
  if (sec.sizes.length < 2) return [];
  const owner = sectionTerritory(g, sec);
  const out: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (owner[k] < 0 || sec.label[k] >= 0) continue;
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (x >= g.w || y >= g.h) continue;
        const nk = idx(g, x, y);
        if (owner[nk] >= 0 && owner[nk] !== owner[k]) out.push({ i, j });
      }
    }
  }
  return out;
}
