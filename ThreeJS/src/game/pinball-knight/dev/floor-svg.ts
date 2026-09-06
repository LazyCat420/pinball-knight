/**
 * FLOOR → SVG. The instrument the census cannot replace.
 *
 * `maze/piece-rules.ts` states the reason in its own header, and it was learned
 * the expensive way: "every rule below is here because a floor was RENDERED and
 * the defect was visible in the screenshot", after an adjacency metric produced
 * a confident 76.6% failure rate that was pure artefact. When the question is
 * "does this look right", the instrument is a picture.
 *
 * So this is the other half of `dev/pattern-census.ts`: the census says how
 * often something happens, this says what it looks like. Both, or neither.
 *
 * ── Why SVG and not a PNG ──────────────────────────────────────────────────
 *
 * A mega floor is 300x200 tiles or more. At any pixel budget that fits on
 * screen, a raster loses exactly the thing under inspection — whether a curve
 * meets a corridor, which way a pad points. SVG zooms, and it needs no canvas
 * dependency in node, so this module stays as pure as the rest of the maze
 * layer. Floor tiles are merged into horizontal RUNS rather than emitted per
 * tile: 40k tiles becomes a few thousand rects, and the file opens instantly.
 *
 * ── What is drawn, and why each layer is separable ─────────────────────────
 *
 * Layers are `<g id=…>` so a reader can hide one in a browser's inspector and
 * ask a single question: geometry alone answers "is this maze repetitive",
 * parts alone answers "is the furniture spread evenly", arcs alone answers "do
 * the curves go anywhere". Reading all three at once is how the last audit
 * mistook masonry for geometry.
 *
 * The one deliberate colour decision: SHAPED wall tiles (slants, rounds, arc
 * bands) are tinted differently from plain wall. A curve and a staircase of
 * square corners are indistinguishable in a two-colour render, and telling them
 * apart is most of what this tool is for.
 */
import { type Grid, at, idx, isWalkable, T_CRACKED, T_STAIRS } from "../maze/generator";
import { SHAPE_FULL, SHAPE_ARC } from "../engine/tile-shape";
import type { PartSpotKind, PinballPartSpot } from "../maze/decorate";
import {
  isRecoveryPort,
  orientationsOf,
  TWO_LEG_KINDS,
  type Assembly,
  type AssemblyPort,
  type PartRole,
} from "../maze/assembly";
import { machineNamed } from "../maze/assembly-lib";
import type { MegaFloor } from "./mega-floor";

export interface SvgOptions {
  /** Pixels per tile. 4 reads well on screen; 8 for a printable close-up. */
  px?: number;
  /** Draw the part layer. Off isolates the geometry question. */
  parts?: boolean;
  /** Draw circuit rings and machine footprints. */
  groups?: boolean;
  /**
   * Render only this tile window.
   *
   * A whole mega floor at a readable zoom is a 3000px image, and the defects
   * that matter — is this curve attached to anything, does that booster face a
   * wall — are two tiles wide. The overview says WHERE to look; a crop is how
   * you look. Emitted as a viewBox rather than by filtering geometry, so a
   * curve half outside the window still draws its visible half.
   */
  crop?: { i: number; j: number; w: number; h: number };

  // ── THE MACHINE-ERA LAYERS ────────────────────────────────────────────────
  //
  // Every one of these defaults OFF, and that is not timidity. The four layers
  // above answer "does this maze look right"; these four answer "did the
  // generator's authored structure survive", which is a different question with
  // a different reader. Defaulting them on would change the picture — and any
  // snapshot of it — for every existing caller that only wanted the first
  // question. `!== false` above vs `=== true` here is the whole difference.

  /**
   * MACHINE DETAIL — footprint, name, id, parts coloured by `PartRole`, and the
   * `seq` order drawn as a chain you can follow.
   *
   * Distinct from `groups`, which draws one anonymous box per machine from its
   * parts' bounding box. This layer recovers the ORIENTED DEFINITION (see
   * `fitMachine`) and draws the machine's declared footprint, so a machine
   * whose parts were pulled apart downstream reads as a box with holes in it
   * rather than as a smaller box.
   */
  machines?: boolean;

  /**
   * PORTS — each port as an arrow along its TRAVEL vector.
   *
   * `maze/assembly.ts` is explicit that the travel vector is not the outward
   * normal ("a ball entering the west side is travelling EAST") and that
   * confusing the two is the obvious way to build a back-to-front router. A
   * renderer that drew normals would make a correct router look broken and a
   * broken one look correct, so this draws travel, and the legend says so.
   */
  ports?: boolean;

  /**
   * LAYER COLOURING — every part tinted by which pass placed it.
   *
   * This is the picture the chain pass needed. `chain`-tagged parts sat at 0.0
   * per floor for weeks while three passes wrote about them; a render that
   * colours by placing layer shows an empty colour as an empty colour. Colour
   * here deliberately overrides the FAMILY colouring of the `parts` layer —
   * turn one on or the other, never both expecting to read both.
   */
  layers?: boolean;

  /**
   * LAUNCHER EXIT RAYS — a short ray along the direction a launcher actually
   * THROWS the player.
   *
   * Not the same vector as the part glyph's arrowhead, and that is the point:
   * a `boostcorner` is entered on `dir` and leaves on `dir2`, and a
   * `boostcurve` leaves along a non-cardinal TANGENT that no straight ray
   * describes at all. See `exitRayFor`.
   */
  rays?: boolean;

  /**
   * The legend panel. Defaults ON whenever any machine-era layer is on and OFF
   * otherwise, which is what keeps an existing caller's bytes identical while
   * making the new picture self-explanatory without a second flag to remember.
   */
  legend?: boolean;

  /** Length of an exit ray, in tiles. 3 is the pipeline's own MIN_RUNWAY claim
   *  — the distance an exit must have clear to not be a launch orphan. */
  rayTiles?: number;
}

/** Part families, by what the player does with them. Colour follows FUNCTION,
 *  never kind, so a floor with six launcher kinds still reads as "one job". */
// Exported because it is the one EXHAUSTIVE table over `PartSpotKind` in the
// tree — `Record<PartSpotKind, …>` on an object literal is checked both ways,
// so it can neither miss a kind nor invent one, and `decorate.test.ts` sweeps
// the density clamp's exemption set over its keys rather than over a list that
// would quietly stop covering new kinds.
export const FAMILY: Record<PartSpotKind, "launch" | "bounce" | "bank" | "hazard" | "score"> = {
  booster: "launch",
  boostcorner: "launch",
  boostcurve: "launch",
  jumppad: "launch",
  spring: "launch",
  ramp: "launch",
  flipper: "launch",
  // A flywheel is a launcher whatever you arrived with; a swingarm THROWS you,
  // so it reads as launch too even though it also hurts to meet.
  flywheel: "launch",
  swingarm: "launch",
  slingshot: "bounce",
  bumper: "bounce",
  // A post deflects and keeps your pace — the same job as a slingshot's band,
  // at a fraction of the size.
  magpost: "bounce",
  deflector: "bank",
  mirror: "bank",
  glove: "bank",
  spinpad: "score",
  target: "score",
  rollover: "score",
  lamp: "score",
  magstrip: "score",
  // TRAVERSAL, added by the seesaw/catapult/cannon work. All three exist to put
  // the knight somewhere else at speed, which is the "launch" job however
  // differently they read in the hand. They were missing from this table for
  // its whole life after that landing: `Record<PartSpotKind, …>` DID flag it,
  // and the error sat unread inside a 199-deep tsc baseline that the build does
  // not run (next.config.js sets ignoreBuildErrors). Every seesaw, catapult and
  // cannon on a debug floor plan was drawn with `FAMILY[kind]` = undefined.
  seesaw: "launch",
  catapult: "launch",
  cannon: "launch",
  // A maw eats you; it belongs with the pit it hands you to.
  maw: "hazard",
  oil: "hazard",
  pit: "hazard",
  electric: "hazard",
  firevent: "hazard",
  trapdoor: "hazard",
};

const FAMILY_COLOUR = {
  launch: "#ffab3d",
  bounce: "#ff5a5a",
  bank: "#4fd6e0",
  hazard: "#b57bff",
  score: "#b8e04f",
} as const;

const C = {
  bg: "#0d0f14",
  wall: "#1b2029",
  wallShaped: "#2f3a52",
  wallArc: "#4a5f8a",
  floor: "#8d96a8",
  cracked: "#7a6a3a",
  stairs: "#ffd34d",
  start: "#5affa0",
  doorway: "#3b4a66",
  circuit: "#00e5ff",
  machine: "#ff7ad9",
  text: "#c9d1e0",
  // ── LAUNCH RAYS ───────────────────────────────────────────────────────────
  // Where a launcher actually sends the player. Four colours because the four
  // cases are genuinely different questions, and conflating them is how this
  // project already produced two false findings:
  //
  //   ray        fires along `dir` — the ordinary case.
  //   ray2       a two-leg part (boostcorner/deflector) LEAVES on `dir2`. Drawn
  //              separately because tracing `dir` measures the APPROACH, not the
  //              departure, and would score a corner that banks perfectly into a
  //              target bank as "firing into the wall behind it".
  //   curveRay   `boostcurve` — a ring, never a line. Its heading is a
  //              non-cardinal TANGENT, so a straight ray is meaningless for it
  //              (see the handler comment in entities/pinball-collide.ts). Drawing
  //              one anyway is exactly the mistake that reported this kind as
  //              100% broken on every floor.
  //   brokenRay  a two-leg part whose `dir2` is ZERO — a grab-throw along a zero
  //              vector, i.e. the knight is caught and never released. This is
  //              the `corner-missing-leg` defect made visible.
  ray: "#7cff9b",
  ray2: "#ffb347",
  curveRay: "#b48cff",
  brokenRay: "#ff4d5e",
} as const;

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
}

/** Merge each row's like-coloured tiles into runs. This is the whole reason the
 *  file is openable: per-tile rects on a 300x200 floor is 60k nodes. */
function tileRuns(g: Grid, px: number, colourOf: (i: number, j: number) => string | null): string {
  const out: string[] = [];
  for (let j = 0; j < g.h; j++) {
    let runStart = -1;
    let runColour: string | null = null;
    for (let i = 0; i <= g.w; i++) {
      const c = i < g.w ? colourOf(i, j) : null;
      if (c === runColour) continue;
      if (runColour !== null && runStart >= 0) {
        out.push(`<rect x="${runStart * px}" y="${j * px}" width="${(i - runStart) * px}" height="${px}" fill="${runColour}"/>`);
      }
      runColour = c;
      runStart = i;
    }
  }
  return out.join("");
}

/** A part's glyph: a dot for the omnidirectional ones, an arrowhead for the
 *  rest. Direction is not decoration here — "the booster fires into the wall"
 *  is only visible if the render commits to which way it points. */
function partGlyph(p: PinballPartSpot, px: number): string {
  const fam = FAMILY[p.kind] ?? "score";
  const col = FAMILY_COLOUR[fam];
  const cx = (p.i + 0.5) * px;
  const cy = (p.j + 0.5) * px;
  const r = px * 0.42;
  const dirLen = Math.hypot(p.dirI, p.dirJ);
  if (fam === "bounce" || dirLen < 1e-6) {
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}"/>`;
  }
  const ux = p.dirI / dirLen;
  const uy = p.dirJ / dirLen;
  const tip = `${(cx + ux * r * 1.9).toFixed(1)},${(cy + uy * r * 1.9).toFixed(1)}`;
  const a = `${(cx - ux * r + -uy * r * 0.8).toFixed(1)},${(cy - uy * r + ux * r * 0.8).toFixed(1)}`;
  const b = `${(cx - ux * r - -uy * r * 0.8).toFixed(1)},${(cy - uy * r - ux * r * 0.8).toFixed(1)}`;
  const head = `<polygon points="${tip} ${a} ${b}" fill="${col}"/>`;
  // A two-leg part (corner booster, deflector) is entered on dir and LEAVES on
  // dir2. Drawing only the first leg is how a corner reads as a straight pad.
  const d2 = Math.hypot(p.dir2I, p.dir2J);
  if (d2 > 1e-6) {
    const vx = p.dir2I / d2;
    const vy = p.dir2J / d2;
    return (
      head +
      `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + vx * r * 2.4).toFixed(1)}" y2="${(cy + vy * r * 2.4).toFixed(1)}" stroke="${col}" stroke-width="${(px * 0.22).toFixed(2)}" stroke-linecap="round" opacity="0.85"/>`
    );
  }
  return head;
}

/** An arc feature as a real SVG arc, in tile space scaled by px. */
function arcPath(f: { cx: number; cz: number; r: number; a0: number; span: number }, px: number): string {
  if (f.span >= Math.PI * 2 - 1e-3) {
    return `<circle cx="${(f.cx * px).toFixed(1)}" cy="${(f.cz * px).toFixed(1)}" r="${(f.r * px).toFixed(1)}" fill="none"/>`;
  }
  const x0 = (f.cx + f.r * Math.cos(f.a0)) * px;
  const y0 = (f.cz + f.r * Math.sin(f.a0)) * px;
  const x1 = (f.cx + f.r * Math.cos(f.a0 + f.span)) * px;
  const y1 = (f.cz + f.r * Math.sin(f.a0 + f.span)) * px;
  const large = f.span > Math.PI ? 1 : 0;
  return `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${(f.r * px).toFixed(1)} ${(f.r * px).toFixed(1)} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none"/>`;
}

const ARC_COLOUR: Record<string, string> = {
  track: "#00ff9d",
  island: "#ffd34d",
  funnel: "#ff7ad9",
  sweep: "#7aa2ff",
};

// ═══════════════════════════════════════════════════════════════════════════
//  THE MACHINE-ERA LAYERS — pure derivation first, drawing second.
//
//  Everything between here and `renderFloorSvg` is a function from data to
//  data: a colour, a label, a ray, a fitted machine. None of it touches a
//  string of SVG. That split is deliberate and it is what makes this testable
//  without an XML parser — a test can ask "which layer placed this part" and
//  "which way does this corner throw" and get an answer, where a test against
//  the rendered markup can only ask whether some text appeared somewhere.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Which PASS placed a part. Not a property of the part kind — the same booster
 * is a spine booster, a circuit filler or a loose deal depending only on who
 * put it there, and that is exactly the question this answers.
 */
export type PartLayer = "machine" | "chute" | "vault" | "chain" | "circuit" | "spine" | "deal";

export const LAYER_COLOUR: Record<PartLayer, string> = {
  machine: "#ffab3d",
  chute: "#ffd34d",
  vault: "#b57bff",
  chain: "#5affa0",
  circuit: "#00e5ff",
  spine: "#ff7ad9",
  deal: "#8d96a8",
};

/**
 * The order layers are TESTED in, and therefore the order they mask each other
 * in. A part can carry several tags at once (`decorate.ts` scores
 * `spine + circuit + chain` as a sum, so all three co-occur), so a colour has
 * to choose, and the choice is not neutral.
 *
 * The rule: the more SPECIFIC and the more FRAGILE the pass, the earlier it
 * appears. `chain` sits ahead of `circuit` and `spine` for exactly the reason
 * this layer exists — chain-tagged parts read 0.0 per floor for weeks, and a
 * palette that let the spine paint over them would have hidden the recovery as
 * thoroughly as it hid the outage.
 */
const LAYER_ORDER: readonly PartLayer[] = ["machine", "chute", "vault", "chain", "circuit", "spine"];

/** Which layer placed this part. Total: every part gets exactly one, and `deal`
 *  — the corridor deal, the pass with no tag of its own — is the residue. */
export function layerOf(p: PinballPartSpot): PartLayer {
  if (p.asm !== undefined) return "machine";
  if (p.chute) return "chute";
  if (p.vault) return "vault";
  if (p.chain) return "chain";
  if (p.circuit !== undefined) return "circuit";
  if (p.spine) return "spine";
  return "deal";
}

/** Count parts per layer. Sums to `parts.length` by construction — the legend
 *  prints these, so a layer at zero is visible as a zero rather than as an
 *  absent swatch nobody thought to miss. */
export function layerCounts(parts: readonly PinballPartSpot[]): Record<PartLayer, number> {
  const out: Record<PartLayer, number> = { machine: 0, chute: 0, vault: 0, chain: 0, circuit: 0, spine: 0, deal: 0 };
  for (const p of parts) out[layerOf(p)]++;
  return out;
}

/** What a part is FOR inside its machine, as a colour. Eight roles, eight
 *  hues — `turn` and `transfer` are deliberately far apart because a bend and
 *  a teleport are the two things most easily confused on a still picture. */
export const ROLE_COLOUR: Record<PartRole, string> = {
  drive: "#ffab3d",
  turn: "#4fd6e0",
  score: "#b8e04f",
  rebound: "#ff5a5a",
  hazard: "#b57bff",
  capture: "#ff2fa0",
  transfer: "#ffffff",
  dress: "#6b7488",
};

/** Port colour by FLOW. Green = a link you can build a chain on (`eject`
 *  re-imposes a known vector), blue = one that bleeds speed (`ballistic`), red
 *  = one that must never be chained at all (`impact`). Amber = the recovery
 *  landing, which overrides flow because it answers a different question. */
export const FLOW_COLOUR: Record<NonNullable<AssemblyPort["flow"]>, string> = {
  ballistic: "#7aa2ff",
  eject: "#5affa0",
  impact: "#ff5a5a",
};

export const RECOVERY_COLOUR = "#ffd34d";

/**
 * WHERE A LAUNCHER ACTUALLY THROWS.
 *
 * Three cases, and two of them have already been got wrong once each:
 *
 *  · `boostcurve` — `dirI/dirJ` is a float TANGENT off a fitted curve
 *    (`decorate.ts` pushes `dirI: tan[0]`), and `pinball-collide.boostcurve`
 *    sets momentum straight off it. The heading is not cardinal and it does not
 *    stay put along the shot, so a straight ray is not an approximation of it —
 *    it is a different claim. This returns `curve`, which draws a marker and no
 *    ray, and the legend says why.
 *
 *  · the TWO-LEG kinds (`boostcorner`, `deflector`) — entered on `dir`, LEAVING
 *    on `dir2`. Drawing `dir` would put the ray on the way IN. A two-leg part
 *    whose `dir2` is (0,0) is the `corner-missing-leg` defect `assembly.ts`
 *    documents (a grab-throw along a zero vector: caught and never released),
 *    so it gets its own `broken` verdict rather than being silently skipped —
 *    an absent ray and a zero-vector throw must not look the same.
 *
 *  · every other `launch`-family part — `dir`, which is what it fires along.
 *
 * Anything else has no exit heading and returns null. Order of the tests is
 * load-bearing: `boostcurve` and `boostcorner` are both in the launch family,
 * so the generic branch must come last.
 */
export type ExitRay =
  | { kind: "ray"; i: number; j: number; ux: number; uy: number; leg: "dir" | "dir2" }
  | { kind: "curve"; i: number; j: number }
  | { kind: "broken"; i: number; j: number };

export function exitRayFor(p: PinballPartSpot): ExitRay | null {
  if (p.kind === "boostcurve") return { kind: "curve", i: p.i, j: p.j };
  if (TWO_LEG_KINDS.has(p.kind)) {
    const len = Math.hypot(p.dir2I, p.dir2J);
    if (len < 1e-6) return { kind: "broken", i: p.i, j: p.j };
    return { kind: "ray", i: p.i, j: p.j, ux: p.dir2I / len, uy: p.dir2J / len, leg: "dir2" };
  }
  if (FAMILY[p.kind] !== "launch") return null;
  const len = Math.hypot(p.dirI, p.dirJ);
  if (len < 1e-6) return null;
  return { kind: "ray", i: p.i, j: p.j, ux: p.dirI / len, uy: p.dirJ / len, leg: "dir" };
}

/** A port resolved onto floor tiles. Mirrors `assembly-place.ts PlacedPort`
 *  field for field, defaults included (`ballistic`, 0), because it is the same
 *  projection — this module recovers it, that one records it. */
export interface FittedPort {
  i: number;
  j: number;
  /** The ball's TRAVEL vector. Never the outward normal. */
  di: number;
  dj: number;
  way: AssemblyPort["way"];
  flow: NonNullable<AssemblyPort["flow"]>;
  minSpeed: number;
  tag?: string;
  recovery: boolean;
}

export interface TileBox {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * One machine, recovered from the flat part list.
 *
 * `matched`/`observed` is the fit's own confidence and it is PRINTED on the
 * box. A renderer that silently drew its best guess would turn a machine the
 * pipeline tore apart into a machine that merely looks a bit odd; a box
 * labelled `3/6` says which of the two you are looking at.
 */
export interface MachineFit {
  id: number;
  name: string;
  /** The observed parts carrying this `asm.id`. */
  parts: PinballPartSpot[];
  /** The oriented definition that best explains them, if one does. */
  def?: Assembly;
  /** Tiles per authored cell, SOLVED FOR rather than transcribed — see below. */
  scale: number;
  /** Footprint origin in tiles. Meaningless when `def` is undefined. */
  i0: number;
  j0: number;
  matched: number;
  observed: number;
  /** The declared footprint when fitted; the parts' bounding box when not. */
  box: TileBox;
  ports: FittedPort[];
}

/**
 * Scales tried when fitting. `assembly-place.ts` scales authored cells to tiles
 * by a PRIVATE `CELL`, and transcribing a private constant into a debug tool is
 * how the tool starts quietly disagreeing with the code it exists to observe
 * (the tool keeps drawing confidently; only the picture is wrong). So the scale
 * is solved for instead: try each, keep whichever explains the most parts. If
 * `CELL` ever moves the picture follows it with no edit here.
 */
const FIT_SCALES: readonly number[] = [1, 2, 3, 4];

function boxOfParts(parts: readonly PinballPartSpot[]): TileBox {
  const box: TileBox = { i0: parts[0]?.i ?? 0, j0: parts[0]?.j ?? 0, i1: parts[0]?.i ?? 0, j1: parts[0]?.j ?? 0 };
  for (const p of parts) {
    box.i0 = Math.min(box.i0, p.i);
    box.j0 = Math.min(box.j0, p.j);
    box.i1 = Math.max(box.i1, p.i);
    box.j1 = Math.max(box.j1, p.j);
  }
  return box;
}

/**
 * Recover a placed machine's ORIENTATION AND ORIGIN from its parts.
 *
 * `AssemblyRef` carries `{id, name, role, seq}` and the plan keeps no
 * `PlacedAssembly`, so the ports — the whole reason machines compose — are not
 * on the floor anywhere. They are, however, RECOVERABLE: the parts landed at
 * `origin + cell * scale` from one of `orientationsOf(def)`, so anchoring each
 * definition part on each observed part of the same kind enumerates every
 * origin that could have produced this floor, and the one that explains the
 * most parts is the placement.
 *
 * Ranked, not first-fit, and the ranking is total so the picture is
 * deterministic: matches desc, then the fit whose projected extent is closest
 * to the observed extent, then scale, orientation index and origin ascending.
 */
export function fitMachine(
  id: number,
  name: string,
  observed: readonly PinballPartSpot[],
  lookup: (n: string) => Assembly | undefined = machineNamed,
): MachineFit {
  const parts = [...observed];
  const fallback: MachineFit = {
    id,
    name,
    parts,
    scale: 0,
    i0: parts[0]?.i ?? 0,
    j0: parts[0]?.j ?? 0,
    matched: 0,
    observed: parts.length,
    box: boxOfParts(parts),
    ports: [],
  };
  const base = lookup(name);
  if (!base || !parts.length) return fallback;

  const obs = boxOfParts(parts);
  const obsSpanI = obs.i1 - obs.i0;
  const obsSpanJ = obs.j1 - obs.j0;
  const oris = orientationsOf(base);

  let best: { a: Assembly; o: number; s: number; i0: number; j0: number; m: number; err: number } | null = null;
  for (let o = 0; o < oris.length; o++) {
    const a = oris[o];
    if (!a.parts.length) continue;
    const defSpanI = Math.max(...a.parts.map((q) => q.ci)) - Math.min(...a.parts.map((q) => q.ci));
    const defSpanJ = Math.max(...a.parts.map((q) => q.cj)) - Math.min(...a.parts.map((q) => q.cj));
    for (const s of FIT_SCALES) {
      const err = Math.abs(defSpanI * s - obsSpanI) + Math.abs(defSpanJ * s - obsSpanJ);
      const seen = new Set<string>();
      for (const dp of a.parts) {
        for (const op of parts) {
          if (op.kind !== dp.kind) continue;
          const i0 = op.i - dp.ci * s;
          const j0 = op.j - dp.cj * s;
          const key = `${i0},${j0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const cells = new Set(a.parts.map((q) => `${i0 + q.ci * s},${j0 + q.cj * s},${q.kind}`));
          let m = 0;
          for (const q of parts) if (cells.has(`${q.i},${q.j},${q.kind}`)) m++;
          const cand = { a, o, s, i0, j0, m, err };
          if (!best) {
            best = cand;
            continue;
          }
          const better =
            m !== best.m
              ? m > best.m
              : err !== best.err
                ? err < best.err
                : s !== best.s
                  ? s < best.s
                  : o !== best.o
                    ? o < best.o
                    : i0 !== best.i0
                      ? i0 < best.i0
                      : j0 < best.j0;
          if (better) best = cand;
        }
      }
    }
  }
  if (!best) return fallback;

  const { a, s, i0, j0 } = best;
  const cellsI = a.floor.map(([ci]) => ci);
  const cellsJ = a.floor.map(([, cj]) => cj);
  const box: TileBox = a.floor.length
    ? {
        i0: i0 + Math.min(...cellsI) * s,
        j0: j0 + Math.min(...cellsJ) * s,
        i1: i0 + Math.max(...cellsI) * s + s - 1,
        j1: j0 + Math.max(...cellsJ) * s + s - 1,
      }
    : boxOfParts(parts);

  return {
    id,
    name,
    parts,
    def: a,
    scale: s,
    i0,
    j0,
    matched: best.m,
    observed: parts.length,
    box,
    // Same projection and the same defaults as `placePorts` in
    // `assembly-place.ts`: flow falls back to `ballistic` (momentum preserved,
    // so speed has to be checked) and minSpeed to 0.
    ports: a.ports.map((p) => ({
      i: i0 + p.ci * s,
      j: j0 + p.cj * s,
      di: p.dir.di,
      dj: p.dir.dj,
      way: p.way,
      flow: p.flow ?? "ballistic",
      minSpeed: p.minSpeed ?? 0,
      tag: p.tag,
      recovery: isRecoveryPort(p),
    })),
  };
}

/** Every machine on the floor, in id order. */
export function fitMachines(
  parts: readonly PinballPartSpot[],
  lookup: (n: string) => Assembly | undefined = machineNamed,
): MachineFit[] {
  const groups = new Map<number, { name: string; parts: PinballPartSpot[] }>();
  for (const p of parts) {
    if (!p.asm) continue;
    const g = groups.get(p.asm.id);
    if (g) g.parts.push(p);
    else groups.set(p.asm.id, { name: p.asm.name ?? "", parts: [p] });
  }
  return [...groups.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([id, g]) => fitMachine(id, g.name, g.parts, lookup));
}

/**
 * A machine's parts split into CONTIGUOUS sequence runs.
 *
 * Drawn as chains, so the eye follows the order the machine intends. The split
 * is on a GAP in `seq`, not on a magic stride: `LOOP_REACTOR` bands its three
 * lanes 0-1 / 10-11 / 20-21 and joining 1 to 10 would draw a lane change that
 * does not exist, but hard-coding `LOOP_LANE_STRIDE` here would agree with that
 * one machine and be wrong for the next one authored to a different band. A
 * jump of more than one breaks the chain, which is true of any banding.
 *
 * Parts with no `seq` are order-less by definition and belong to no run.
 */
export function seqRuns(parts: readonly PinballPartSpot[]): PinballPartSpot[][] {
  const ordered = parts.filter((p) => p.asm?.seq !== undefined).sort((a, b) => (a.asm!.seq as number) - (b.asm!.seq as number));
  const runs: PinballPartSpot[][] = [];
  let cur: PinballPartSpot[] = [];
  let prev: number | null = null;
  for (const p of ordered) {
    const s = p.asm!.seq as number;
    if (prev !== null && s - prev > 1) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
    }
    cur.push(p);
    prev = s;
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// ── drawing ────────────────────────────────────────────────────────────────

const cx = (i: number, px: number): number => (i + 0.5) * px;
const cy = (j: number, px: number): number => (j + 0.5) * px;
const n1 = (v: number): string => v.toFixed(1);

/** An arrowhead polygon at (x,y) pointing along (ux,uy), half-width `w`. */
function arrowHead(x: number, y: number, ux: number, uy: number, w: number): string {
  const back = w * 1.7;
  const a = `${n1(x - ux * back - uy * w)},${n1(y - uy * back + ux * w)}`;
  const b = `${n1(x - ux * back + uy * w)},${n1(y - uy * back - ux * w)}`;
  return `<polygon points="${n1(x)},${n1(y)} ${a} ${b}"/>`;
}

/** MACHINE DETAIL: declared footprint, identity, role-coloured parts, seq. */
function machineLayer(fits: readonly MachineFit[], px: number): string {
  if (!fits.length) return "";
  const out: string[] = [`<g id="machines">`];
  for (const f of fits) {
    const x = f.box.i0 * px;
    const y = f.box.j0 * px;
    const w = (f.box.i1 - f.box.i0 + 1) * px;
    const h = (f.box.j1 - f.box.j0 + 1) * px;
    const fitted = f.def !== undefined;
    out.push(
      `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" fill="none" ` +
        `stroke="${fitted ? C.machine : "#ff5a5a"}" stroke-width="${(px * 0.22).toFixed(2)}" ` +
        `stroke-dasharray="${(px * 0.9).toFixed(1)} ${(px * 0.5).toFixed(1)}" opacity="0.9"/>`,
    );
    // Identity AND fit quality. `4/6` is a machine the pipeline took two parts
    // out of; `?` is a name with no definition in the library at all.
    const label = fitted ? `${f.name} #${f.id}  ${f.matched}/${f.observed}` : `${f.name} #${f.id}  ?`;
    out.push(
      `<text x="${n1(x)}" y="${n1(y - px * 0.5)}" font-family="monospace" font-size="${(px * 1.7).toFixed(1)}" ` +
        `fill="${fitted ? C.machine : "#ff5a5a"}">${esc(label)}</text>`,
    );

    // The seq chain, under the parts, so the order reads as a path.
    for (const run of seqRuns(f.parts)) {
      const pts = run.map((p) => `${n1(cx(p.i, px))},${n1(cy(p.j, px))}`).join(" ");
      out.push(
        `<polyline points="${pts}" fill="none" stroke="${C.machine}" stroke-width="${(px * 0.16).toFixed(2)}" opacity="0.55"/>`,
      );
    }

    for (const p of f.parts) {
      const role = p.asm?.role ?? "dress";
      const col = ROLE_COLOUR[role] ?? ROLE_COLOUR.dress;
      out.push(
        `<circle cx="${n1(cx(p.i, px))}" cy="${n1(cy(p.j, px))}" r="${(px * 0.34).toFixed(1)}" fill="${col}" stroke="#0d0f14" stroke-width="${(px * 0.1).toFixed(2)}"/>`,
      );
      const seq = p.asm?.seq;
      if (seq !== undefined) {
        out.push(
          `<text x="${n1(cx(p.i, px) + px * 0.45)}" y="${n1(cy(p.j, px) - px * 0.35)}" font-family="monospace" ` +
            `font-size="${(px * 1.3).toFixed(1)}" fill="${col}">${seq}</text>`,
        );
      }
    }
  }
  out.push(`</g>`);
  return out.join("");
}

/**
 * PORTS, as arrows along the ball's TRAVEL vector.
 *
 * An `in` port's arrow ARRIVES at the port tile and an `out` port's LEAVES it,
 * which is the same vector drawn from two different ends — that is what makes
 * a back-to-front pairing visible as two arrows pointing at each other rather
 * than as two arrows that merely look similar. `both` gets a head at each end.
 */
function portsLayer(fits: readonly MachineFit[], px: number): string {
  const ports = fits.flatMap((f) => f.ports);
  if (!ports.length) return "";
  const L = px * 2.4;
  const hw = px * 0.42;
  const out: string[] = [`<g id="ports">`];
  for (const p of ports) {
    const len = Math.hypot(p.di, p.dj);
    const col = p.recovery ? RECOVERY_COLOUR : (FLOW_COLOUR[p.flow] ?? FLOW_COLOUR.ballistic);
    const x = cx(p.i, px);
    const y = cy(p.j, px);
    if (len < 1e-6) {
      out.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${(px * 0.3).toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(px * 0.2).toFixed(2)}"/>`);
      continue;
    }
    const ux = p.di / len;
    const uy = p.dj / len;
    // in  : tail behind the tile, head ON the tile — the ball arriving.
    // out : tail on the tile, head ahead of it — the ball leaving.
    // both: centred on the tile, a head at each end.
    const [tx, ty, hx, hy] =
      p.way === "in"
        ? [x - ux * L, y - uy * L, x, y]
        : p.way === "out"
          ? [x, y, x + ux * L, y + uy * L]
          : [x - ux * L * 0.5, y - uy * L * 0.5, x + ux * L * 0.5, y + uy * L * 0.5];
    // ballistic = thin solid (momentum preserved, speed must be checked),
    // eject = thick solid (a known vector; the reliable link),
    // impact = dashed (deliberately not chainable).
    const dash = p.flow === "impact" ? ` stroke-dasharray="${(px * 0.6).toFixed(1)} ${(px * 0.4).toFixed(1)}"` : "";
    const wdt = p.flow === "eject" ? px * 0.28 : px * 0.16;
    out.push(
      `<line x1="${n1(tx)}" y1="${n1(ty)}" x2="${n1(hx)}" y2="${n1(hy)}" stroke="${col}" stroke-width="${wdt.toFixed(2)}"${dash} stroke-linecap="round"/>`,
    );
    out.push(`<g fill="${col}">${arrowHead(hx, hy, ux, uy, hw)}</g>`);
    if (p.way === "both") out.push(`<g fill="${col}">${arrowHead(tx, ty, -ux, -uy, hw)}</g>`);
    if (p.recovery) {
      // The landing tile itself, so a recovery port reads as a PLACE the failed
      // rider is put down and not merely as another exit in a different colour.
      out.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${(px * 0.7).toFixed(1)}" fill="none" stroke="${col}" stroke-width="${(px * 0.14).toFixed(2)}" opacity="0.8"/>`);
    }
    if (p.minSpeed > 0) {
      out.push(
        `<text x="${n1(x + px * 0.6)}" y="${n1(y + px * 1.5)}" font-family="monospace" font-size="${(px * 1.2).toFixed(1)}" fill="${col}">${esc(`>=${p.minSpeed}`)}</text>`,
      );
    }
  }
  out.push(`</g>`);
  return out.join("");
}

/** LAYER COLOURING: one dot per part, tinted by the pass that placed it. */
function layersLayer(parts: readonly PinballPartSpot[], px: number): string {
  if (!parts.length) return "";
  const out: string[] = [`<g id="layers">`];
  for (const p of parts) {
    out.push(
      `<circle cx="${n1(cx(p.i, px))}" cy="${n1(cy(p.j, px))}" r="${(px * 0.4).toFixed(1)}" fill="${LAYER_COLOUR[layerOf(p)]}"/>`,
    );
  }
  out.push(`</g>`);
  return out.join("");
}

/** LAUNCHER EXIT RAYS. See `exitRayFor` for which vector each kind leaves on. */
function raysLayer(parts: readonly PinballPartSpot[], px: number, tiles: number): string {
  const out: string[] = [`<g id="rays">`];
  let any = false;
  for (const p of parts) {
    const r = exitRayFor(p);
    if (!r) continue;
    any = true;
    const x = cx(r.i, px);
    const y = cy(r.j, px);
    if (r.kind === "curve") {
      // NO STRAIGHT RAY. A boostcurve leaves along a fitted tangent that turns
      // along the shot; a straight line here would assert a heading the part
      // does not have. A ring says "launcher, heading not drawable".
      out.push(
        `<circle cx="${n1(x)}" cy="${n1(y)}" r="${(px * 0.85).toFixed(1)}" fill="none" stroke="${C.curveRay}" ` +
          `stroke-width="${(px * 0.16).toFixed(2)}" stroke-dasharray="${(px * 0.35).toFixed(1)} ${(px * 0.35).toFixed(1)}"/>`,
      );
      continue;
    }
    if (r.kind === "broken") {
      const d = px * 0.6;
      out.push(
        `<path d="M ${n1(x - d)} ${n1(y - d)} L ${n1(x + d)} ${n1(y + d)} M ${n1(x + d)} ${n1(y - d)} L ${n1(x - d)} ${n1(y + d)}" ` +
          `stroke="${C.brokenRay}" stroke-width="${(px * 0.22).toFixed(2)}" fill="none"/>`,
      );
      continue;
    }
    const L = tiles * px;
    const col = r.leg === "dir2" ? C.ray2 : C.ray;
    out.push(
      `<line x1="${n1(x)}" y1="${n1(y)}" x2="${n1(x + r.ux * L)}" y2="${n1(y + r.uy * L)}" stroke="${col}" ` +
        `stroke-width="${(px * 0.14).toFixed(2)}" opacity="0.9"/>`,
    );
    out.push(`<g fill="${col}">${arrowHead(x + r.ux * L, y + r.uy * L, r.ux, r.uy, px * 0.3)}</g>`);
  }
  out.push(`</g>`);
  return any ? out.join("") : "";
}

interface Chip {
  colour: string;
  label: string;
  /** `dash` and `ring` draw the glyph the layer actually uses, so the legend is
   *  a sample of the picture rather than a second, drifting description of it. */
  style?: "dot" | "line" | "dash" | "ring" | "cross" | "thick";
}

/**
 * THE LEGEND. Only the sections whose layer is on, so it never explains a
 * colour that is not in the picture — a legend that lists everything trains the
 * reader to ignore it.
 */
function legendPanel(sections: ReadonlyArray<{ title: string; chips: Chip[] }>, x0: number, y0: number, width: number): { svg: string; height: number } {
  const FS = 11;
  const LH = 16;
  const PAD = 6;
  const out: string[] = [`<g id="legend" font-family="monospace" font-size="${FS}">`];
  let y = y0 + LH;
  for (const sec of sections) {
    out.push(`<text x="${x0 + PAD}" y="${y}" fill="${C.text}" opacity="0.65">${esc(sec.title)}</text>`);
    let x = x0 + PAD + sec.title.length * 6.7 + 10;
    for (const c of sec.chips) {
      const w = 16 + c.label.length * 6.7 + 10;
      if (x + w > x0 + width - PAD) {
        y += LH;
        x = x0 + PAD + sec.title.length * 6.7 + 10;
      }
      const gy = y - 4;
      if (c.style === "line" || c.style === "dash" || c.style === "thick") {
        const dash = c.style === "dash" ? ` stroke-dasharray="3 2"` : "";
        out.push(`<line x1="${x}" y1="${gy}" x2="${x + 12}" y2="${gy}" stroke="${c.colour}" stroke-width="${c.style === "thick" ? 3.4 : 1.8}"${dash}/>`);
      } else if (c.style === "ring") {
        out.push(`<circle cx="${x + 6}" cy="${gy}" r="5" fill="none" stroke="${c.colour}" stroke-width="1.6" stroke-dasharray="2 2"/>`);
      } else if (c.style === "cross") {
        out.push(`<path d="M ${x} ${gy - 5} L ${x + 11} ${gy + 5} M ${x + 11} ${gy - 5} L ${x} ${gy + 5}" stroke="${c.colour}" stroke-width="1.8" fill="none"/>`);
      } else {
        out.push(`<circle cx="${x + 6}" cy="${gy}" r="5" fill="${c.colour}"/>`);
      }
      out.push(`<text x="${x + 17}" y="${y}" fill="${C.text}">${esc(c.label)}</text>`);
      x += w;
    }
    y += LH;
  }
  out.push(`</g>`);
  return { svg: out.join(""), height: y - y0 + PAD };
}

function legendSections(floor: MegaFloor, fits: readonly MachineFit[], opts: SvgOptions): Array<{ title: string; chips: Chip[] }> {
  const secs: Array<{ title: string; chips: Chip[] }> = [];
  if (opts.machines === true) {
    const names = fits.map((f) => `${f.name}#${f.id} ${f.def ? `${f.matched}/${f.observed}` : "?"}`);
    secs.push({
      title: "ROLE  ",
      chips: (Object.keys(ROLE_COLOUR) as PartRole[]).map((r) => ({ colour: ROLE_COLOUR[r], label: r })),
    });
    secs.push({
      title: `MACH ${fits.length} `,
      chips: names.map((n) => ({ colour: C.machine, label: n, style: "dot" as const })),
    });
  }
  if (opts.ports === true) {
    secs.push({
      title: "PORT  ",
      chips: [
        { colour: FLOW_COLOUR.ballistic, label: "ballistic (speed bleeds)", style: "line" },
        { colour: FLOW_COLOUR.eject, label: "eject (known vector)", style: "thick" },
        { colour: FLOW_COLOUR.impact, label: "impact (never chain)", style: "dash" },
        { colour: RECOVERY_COLOUR, label: "recovery landing", style: "ring" },
        { colour: C.text, label: "arrow = ball TRAVEL, not the normal; in lands on the tile, out leaves it, both = 2 heads; >=n is minSpeed" },
      ],
    });
  }
  if (opts.layers === true) {
    const counts = layerCounts(floor.plan.parts);
    secs.push({
      title: "LAYER ",
      chips: LAYER_ORDER.concat("deal").map((l) => ({ colour: LAYER_COLOUR[l], label: `${l} ${counts[l]}` })),
    });
  }
  if (opts.rays === true) {
    secs.push({
      title: "EXIT  ",
      chips: [
        { colour: C.ray, label: "fires along dir", style: "line" },
        { colour: C.ray2, label: "corner/deflector leaves on dir2", style: "line" },
        { colour: C.curveRay, label: "boostcurve: tangent heading, no straight ray", style: "ring" },
        { colour: C.brokenRay, label: "two-leg part with a ZERO dir2 (caught, never released)", style: "cross" },
      ],
    });
  }
  return secs;
}

export function renderFloorSvg(floor: MegaFloor, opts: SvgOptions = {}): string {
  const px = opts.px ?? 4;
  const g = floor.grid;
  const HEADER = 26;
  // The crop is a WINDOW on the same drawing, not a different drawing: every
  // layer below still emits full-floor coordinates and the viewBox does the
  // selecting. That is what keeps a cropped render and the overview provably
  // the same picture.
  const crop = opts.crop;
  const vx = crop ? crop.i * px : 0;
  const vy = crop ? crop.j * px : 0;
  const W = crop ? crop.w * px : g.w * px;
  const H = crop ? crop.h * px : g.h * px;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + HEADER}" viewBox="${vx} 0 ${W} ${H + HEADER}" style="background:${C.bg}">`,
  );
  parts.push(`<rect x="${vx}" width="${W}" height="${H + HEADER}" fill="${C.bg}"/>`);
  parts.push(
    `<text x="${vx + 6}" y="17" font-family="monospace" font-size="13" fill="${C.text}">` +
      esc(
        `MEGA MAP  L${floor.level} ${floor.archetype}/${floor.theme}/${floor.modifier}  seed ${floor.runSeed}  ` +
          `${g.w}x${g.h} tiles  walkable ${floor.walkable} (${floor.areaRatio.toFixed(1)}x shipped)  ` +
          `parts ${floor.plan.parts.length}  arcs ${g.arcs?.length ?? 0}  circuits ${floor.plan.circuits.length}` +
          (crop ? `   CROP ${crop.i},${crop.j} ${crop.w}x${crop.h}` : ""),
      ) +
      `</text>`,
  );
  parts.push(`<g transform="translate(0 ${HEADER - vy})">`);

  // ── walls, tinted by whether they carry a SHAPE ────────────────────────────
  parts.push(`<g id="walls">`);
  parts.push(
    tileRuns(g, px, (i, j) => {
      if (isWalkable(g, i, j)) return null;
      const s = g.shapes[idx(g, i, j)];
      if (s === SHAPE_ARC) return C.wallArc;
      if (s !== SHAPE_FULL) return C.wallShaped;
      return at(g, i, j) === T_CRACKED ? C.cracked : C.wall;
    }),
  );
  parts.push(`</g>`);

  // ── floor ──────────────────────────────────────────────────────────────────
  parts.push(`<g id="floor">`);
  parts.push(
    tileRuns(g, px, (i, j) => {
      if (!isWalkable(g, i, j)) return null;
      return at(g, i, j) === T_STAIRS ? C.stairs : C.floor;
    }),
  );
  parts.push(`</g>`);

  // ── arcs, over the tiles they own ──────────────────────────────────────────
  if (g.arcs?.length) {
    parts.push(`<g id="arcs" stroke-width="${Math.max(1, px * 0.45).toFixed(2)}" opacity="0.95">`);
    for (const f of g.arcs) {
      const col = ARC_COLOUR[f.owner ?? "sweep"] ?? ARC_COLOUR.sweep;
      parts.push(arcPath(f, px).replace('fill="none"', `fill="none" stroke="${col}"`));
    }
    parts.push(`</g>`);
  }

  // ── groups: circuits and machine footprints ───────────────────────────────
  if (opts.groups !== false) {
    parts.push(`<g id="groups" fill="none">`);
    for (const c of floor.plan.circuits) {
      if (!c.ring.length) continue;
      const pts = c.ring.map((t) => `${((t.i + 0.5) * px).toFixed(1)},${((t.j + 0.5) * px).toFixed(1)}`).join(" ");
      parts.push(`<polyline points="${pts}" stroke="${C.circuit}" stroke-width="${(px * 0.3).toFixed(2)}" opacity="0.5"/>`);
    }
    // One box per machine, from its members' bounding box: the router places
    // the machine, so a box that does not look like a machine is the finding.
    const boxes = new Map<number, { i0: number; j0: number; i1: number; j1: number; name: string }>();
    for (const p of floor.plan.parts) {
      if (!p.asm) continue;
      const b = boxes.get(p.asm.id);
      if (b) {
        b.i0 = Math.min(b.i0, p.i);
        b.j0 = Math.min(b.j0, p.j);
        b.i1 = Math.max(b.i1, p.i);
        b.j1 = Math.max(b.j1, p.j);
      } else {
        boxes.set(p.asm.id, { i0: p.i, j0: p.j, i1: p.i, j1: p.j, name: p.asm.name ?? "" });
      }
    }
    for (const b of boxes.values()) {
      const x = (b.i0 - 0.6) * px;
      const y = (b.j0 - 0.6) * px;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${((b.i1 - b.i0 + 2.2) * px).toFixed(1)}" height="${((b.j1 - b.j0 + 2.2) * px).toFixed(1)}" stroke="${C.machine}" stroke-width="${(px * 0.25).toFixed(2)}" opacity="0.8"/>`,
      );
      if (b.name && px >= 4) {
        parts.push(
          `<text x="${x.toFixed(1)}" y="${(y - 1).toFixed(1)}" font-family="monospace" font-size="${(px * 1.6).toFixed(1)}" fill="${C.machine}">${esc(b.name)}</text>`,
        );
      }
    }
    parts.push(`</g>`);
  }

  // ── parts ──────────────────────────────────────────────────────────────────
  if (opts.parts !== false) {
    parts.push(`<g id="parts">`);
    for (const p of floor.plan.parts) parts.push(partGlyph(p, px));
    parts.push(`</g>`);
  }

  // ── endpoints ──────────────────────────────────────────────────────────────
  parts.push(
    `<g id="ends">` +
      `<circle cx="${((floor.start.i + 0.5) * px).toFixed(1)}" cy="${((floor.start.j + 0.5) * px).toFixed(1)}" r="${(px * 1.6).toFixed(1)}" fill="none" stroke="${C.start}" stroke-width="${(px * 0.4).toFixed(2)}"/>` +
      `<circle cx="${((floor.stairs.i + 0.5) * px).toFixed(1)}" cy="${((floor.stairs.j + 0.5) * px).toFixed(1)}" r="${(px * 1.6).toFixed(1)}" fill="none" stroke="${C.stairs}" stroke-width="${(px * 0.4).toFixed(2)}"/>` +
      `</g>`,
  );

  parts.push(`</g></svg>`);
  return parts.join("\n");
}
