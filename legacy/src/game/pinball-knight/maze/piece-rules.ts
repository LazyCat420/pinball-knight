/**
 * THE PIECE REGISTRY — every renderable maze piece, labelled, with its rules.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The floor is assembled from a handful of distinct renderable pieces, and each
 * one had its correctness conditions scattered across the pass that happened to
 * author it — or nowhere at all. `track-socket.ts` gave tiles typed EDGES,
 * which answers "may these two tiles sit side by side"; it does not answer "is
 * this piece, as drawn, a legal instance of its own kind". Those are different
 * questions, and the second one is where the visible nonsense lives: a curved
 * wall band standing in open floor is not an edge-compatibility failure, it is
 * a piece whose own precondition (have stone behind you) was never stated.
 *
 * So this module states them. One table, one label per piece, one rule set per
 * label, one validator. When a new piece kind is added, it gets a row here or
 * it is not finished.
 *
 * ── The method, which matters more than the table ─────────────────────────
 *
 * Every rule below is here because a floor was RENDERED and the defect was
 * visible in the screenshot. That ordering is not incidental. The first attempt
 * at this audit measured arc-tile ADJACENCY — which features own tiles next to
 * which — and produced a confident 76.6% "kink" rate that was almost entirely
 * an artefact: `publishArcs` deliberately marks a 2.5-tile-thick band of wall
 * behind each curve, so two thick bands touching is two wall masses touching,
 * and the renderer never draws owned tiles at all. The metric was measuring
 * something the camera cannot see, and it would have driven a fix for a
 * non-problem.
 *
 * The rule that mattered — BACKING — was invisible to that metric and obvious
 * in a screenshot: 38% of all arc features were partly or wholly unbacked, i.e.
 * curved ribbons drawn across open floor. Measure the quantity, not a proxy;
 * and when the quantity is "does this look right", the instrument is a render.
 *
 * DOM- and three-free. Pure: takes a grid, returns violations.
 */
import { type Grid, type TilePos, idx, at, isWalkable, T_WALL, T_CRACKED, T_STAIRS } from "./generator";
import { SHAPE_FULL, SHAPE_ARC, isShaped, shapeBacking, type ArcFeature } from "../engine/tile-shape";
import { backedFraction, findArcJunctions, MIN_ARC_LEN, MIN_ARC_TILES } from "./arc-contract";
import type { TrackMask } from "./track-carve";
import { nearSealed } from "./track-socket";
import { exitRay, type FlowPart } from "./flow-loops";
import { isDownhill, openRunway } from "./flow-orient";
import { railExit, RAIL_MIN_RUNWAY } from "./arc-sweeps";

/** Open tiles a placed launcher must have ahead of it. Mirrors decorate's
 *  MIN_RUNWAY — deliberately the SAME number, because this gate's whole job is
 *  to re-ask decorate's own question on the grid that actually ships. */
const MIN_PART_RUNWAY = 3;

/**
 * Parts that THROW the player along a heading, and so have somewhere to be
 * pointed wrongly. Everything else on the floor either has no direction
 * (`bumper`), mounts ON a wall by design (`target`, `firevent`), or carries a
 * facing purely for orientation (`glove`, `oil`, `spinpad`, `mirror`,
 * `magstrip`, `rollover`, `pit`, `electric`, `trapdoor`, `lamp`).
 *
 * `boostcorner` IS here, and it is the reason this set has to exist alongside
 * `exitRay` rather than instead of it: it is a two-leg part entered on `dir` and
 * leaving on `dir2`, so it belongs in the census but only when read off the
 * second leg.
 *
 * ⚠️ `deflector` IS DELIBERATELY ABSENT, and it cost a red gate to work out why.
 * It shares the two-leg convention, so it looks like it belongs — but it does
 * not LAUNCH, it banks, and decorate reaches for it precisely when a corner
 * CANNOT support a launch: the bend ladder tries `boostcorner` first and falls
 * through to `deflector` exactly when `launchRunway(outgoing) < CARRY_RUNWAY`.
 * So a runway rule over deflectors flags the fallback for being the fallback —
 * 25 of 30 floors "dirty", every one of them by design. Same shape as the
 * socket table's `road|wall`: when a rule fires on a uniform population,
 * suspect the rule.
 *
 * `boostcurve` is absent too, for the unrelated reason that its heading is a
 * float tangent rather than a cardinal; it is gated at authoring instead (see
 * decorate's layStationSpine).
 */
const THROWING = new Set(["ramp", "booster", "boostcorner", "spring", "slingshot", "flipper", "jumppad"]);

/**
 * The labels. One per thing that ends up on screen as geometry.
 *
 * Deliberately NOT one per tile VALUE — `T_WALL` renders as three different
 * pieces depending on its shape byte, and those three have different rules.
 * The label is what the renderer treats as a unit.
 */
export type PieceLabel =
  | "wall-box" // a solid square block (SHAPE_FULL, not walkable)
  | "wall-bevel" // a 45° slant or radius-1 round corner (single-tile shape)
  | "arc-face" // one multi-tile ArcFeature: the swept curved wall
  | "rubber" // a KickBand riding an arc-face
  | "rail" // a LaneBand riding an arc-face
  | "floor-room" // walkable, off-circuit
  | "floor-road" // walkable, on the circuit
  | "floor-sealed" // walkable, on the circuit, and sealed (the launch chute)
  | "crack" // a smashable secret wall band
  | "stairs"
  // A placed PinballPartSpot — the machine itself, judged as a piece.
  //
  // The registry covered every WALL the floor is made of and nothing that
  // stands on the floor, which left the largest population on screen
  // unexamined: a shipping floor carries 210-260 parts against ~50 arc
  // features. `decorate` validates a part's topology at PLACEMENT, and then
  // `openLaunchTargets` cracks walls open, `carveDoorways` opens more and
  // `assignCornerShapes` — the last tile mutation in the whole pipeline —
  // reshapes them. Nothing has ever looked afterwards.
  | "furniture";

export interface PieceViolation {
  label: PieceLabel;
  rule: string;
  /** Where to look. Tile coords for tile pieces; the feature's centre for arcs. */
  i: number;
  j: number;
  detail: string;
}

/**
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 * Written as prose next to the label they govern so the table IS the spec.
 * Each is checked by `checkPieces` below; the string is what a failure reports.
 */
export const PIECE_RULES: Record<PieceLabel, readonly string[]> = {
  "wall-box": [
    // A wall tile with open floor on 3+ sides is a nub jutting into a room —
    // it reads as unfinished masonry. `removeWallStubs` iterates these away.
    "not a stub: at most 2 open orthogonal neighbours",
    // A wall tile with open floor on all 4 sides is a free-standing pillar.
    "not an isolated pillar",
  ],
  "wall-bevel": [
    // A bevel is a corner CUT off a wall mass. Its two legs must be backed by
    // solid neighbours or the diagonal face floats — tile-shape.shapeBacking
    // names exactly which two.
    "both legs backed by solid neighbours",
  ],
  "arc-face": [
    // THE rule. `arcSweepGeometry` draws the full span from (cx,cz,r,a0,span)
    // without consulting the grid, so an unbacked span is a curved wall
    // standing in open air. This is the one the screenshots were full of.
    "fully backed: stone behind every sampled point of the drawn span",
    // Below ~1.5 tiles a curve reads as a chamfer, not a bank.
    "at least MIN_ARC_LEN of arc",
    // A feature nothing references is drawn from nothing.
    "owns at least MIN_ARC_TILES wall tiles (islands exempt)",
    // Two curves sharing an edge must agree, or they read as a collision
    // between two circles rather than one continuous wall.
    "coherent with any neighbouring feature: no kink, step or curvature flip",
  ],
  rubber: [
    // A KickBand is an angular SUB-span. The kicker renderer draws it from its
    // own a0/span, so a band outside its feature's span is rubber in mid-air.
    "angular range lies inside the owning arc-face's span",
  ],
  rail: [
    "angular range lies inside the owning arc-face's span",
    // ── THE ONE THE SCREENSHOT WAS FULL OF ────────────────────────────────
    // A rail draws CHEVRONS (render/arc-lanes.ts) precisely because it is
    // one-way — a bare strip would read as symmetric. An arrow is a promise
    // about where you are about to be sent, and pointing it at stone five tiles
    // out is a lie the geometry tells the player. It was invisible to every
    // other gate on this floor: `backedFraction` says the wall behind it is
    // fine, `junctionCheck` says the curve is fine. The band IS fine. Where it
    // puts you was never asked about.
    "exit has RAIL_MIN_RUNWAY open tiles along the direction it throws",
    // The Φ contract, extended to the family that was never in it. A rail is a
    // LaneBand on an ArcFeature, not a PinballPartSpot, so flow-orient,
    // flow-loops, breakLaunchDuels and openLaunchTargets have never seen one —
    // and its direction was literally `rng() < 0.5`. See orientArcRails.
    "throws DOWN-Φ: its exit is strictly closer to the stairs than its entry",
  ],
  "floor-room": ["reachable from the spawn"],
  "floor-road": [
    "reachable from the spawn",
    // A lane whose only continuations are solid is a road to nowhere.
    "does not terminate in mid-air",
  ],
  "floor-sealed": [
    // The launch chute. Its whole value is that it commits you.
    "side walls solid for its full length except the mouth",
  ],
  crack: [
    // A secret wall that separates nothing is a smash that opens onto the space
    // you were already in.
    "separates two open tiles (smashing it opens something)",
  ],
  stairs: ["exactly one per floor", "reachable from the spawn"],
  furniture: [
    "stands on walkable floor",
    // Re-measured on the FINAL grid, which is the point of checking here at all
    // rather than trusting decorate's placement-time gates.
    "throws along a heading with MIN_RUNWAY open tiles, or is a deliberate exception",
    // Scoped to ROUTE parts deliberately. `KICKBACK_CHANCE` makes 12% of loose
    // corridor parts intentional rebounds, and `ramp` is ~22% backward by
    // design. A road may not do that: the routes ARE the floor's one-way
    // structure, and decorate.test already pins the claim for boosters — this
    // extends it to every kind that throws, on the finished grid.
    "a route part fires strictly down-Φ",
  ],
};

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The four tiles of an even-aligned crack band, from its NW corner. */
const BAND_TILES = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

/** What a caller must hand over for the rules that judge more than the grid. */
export interface PieceContent {
  /** `buildFlowField(g, stairs)` — unlocks the two Φ rules (rail, furniture). */
  phi?: Int32Array | null;
  /** The finished `plan.parts` — unlocks the furniture rules. */
  parts?: readonly FlowPart[] | null;
}

/**
 * Check every piece on a finished floor against its rules.
 *
 * `mask` is optional: without it the road/sealed rules are skipped (a legacy
 * floor has no circuit), everything else still runs.
 *
 * `content` is optional too, and the rules it unlocks report NOTHING when it is
 * absent rather than passing silently — the same doctrine `doorways-are-uniform`
 * already follows with its "-1 — no doorway plan". A gate that quietly returns
 * "clean" because it was handed nothing to look at is worse than no gate, since
 * it reads as coverage. Callers that have Φ get the rail rules; callers that
 * have the plan get furniture as well.
 */
export function checkPieces(g: Grid, mask?: TrackMask | null, content?: PieceContent): PieceViolation[] {
  const out: PieceViolation[] = [];
  const phi = content?.phi ?? null;
  const push = (label: PieceLabel, rule: string, i: number, j: number, detail: string): void => {
    out.push({ label, rule, i, j, detail });
  };
  const arcs: readonly ArcFeature[] = g.arcs ?? [];

  // ── Tile pieces ────────────────────────────────────────────────────────
  let stairsCount = 0;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      const k = idx(g, i, j);
      const shape = g.shapes[k];
      if (at(g, i, j) === T_STAIRS) stairsCount++;

      if (isWalkable(g, i, j)) continue;

      if (at(g, i, j) === T_CRACKED) {
        // A crack must have open floor beyond it — that is what makes smashing
        // it a shortcut rather than a hole into the room you are already in.
        //
        // ⚠️ MEASURED OVER THE WHOLE BAND, not the tile. A crack is authored as
        // an even-aligned 2x2 (`crackSecretWalls`, `openLaunchTargets.tryCrack`)
        // and the registry's own label calls it a "band" — so the interior tile
        // of a perfectly good band has cracked neighbours on two sides and stone
        // on the other two, and a per-tile test reports it as sealed. It never
        // fired on the geometry sweep because those floors' bands happen to sit
        // squarer; it fired the moment the gate was pointed at decorated floors,
        // where `openLaunchTargets` adds bands against a launcher's terminal
        // wall. The piece is the band; judge the band.
        if ((i & 1) === 0 && (j & 1) === 0) {
          let openAround = 0;
          for (const [bi, bj] of BAND_TILES) {
            const x = i + bi;
            const y = j + bj;
            if (at(g, x, y) !== T_CRACKED) continue;
            openAround += SIDES.filter(([di, dj]) => isWalkable(g, x + di, y + dj)).length;
          }
          if (openAround === 0) push("crack", PIECE_RULES.crack[0], i, j, "the whole 2x2 band is sealed in stone");
        }
        continue;
      }

      if (shape === SHAPE_ARC) continue; // judged as part of its feature below

      if (isShaped(shape)) {
        const back = shapeBacking(shape);
        if (back) {
          for (const v of back) {
            if (isWalkable(g, i + v.x, j + v.z)) {
              push("wall-bevel", PIECE_RULES["wall-bevel"][0], i, j, `leg (${v.x},${v.z}) is open floor`);
              break;
            }
          }
        }
        continue;
      }

      // Plain solid block. A stub pressed against a SEALED lane is exempt: it
      // is the chute's wall, and `removeWallStubs` deliberately refuses to open
      // it (a plunger lane with a hole in the side is a worse defect than a
      // three-sided wall tile). Stated here so the exemption is visible rather
      // than looking like a gap in the gate.
      if (mask && nearSealed(g, mask, i, j)) continue;
      const open = SIDES.filter(([di, dj]) => isWalkable(g, i + di, j + dj)).length;
      if (open >= 4) push("wall-box", PIECE_RULES["wall-box"][1], i, j, "open on all four sides");
      else if (open >= 3) push("wall-box", PIECE_RULES["wall-box"][0], i, j, `${open} open neighbours`);
    }
  }
  if (stairsCount !== 1) {
    push("stairs", PIECE_RULES.stairs[0], 0, 0, `${stairsCount} stairs tiles on the floor`);
  }

  // ── Arc features ───────────────────────────────────────────────────────
  const tilesPer = new Int32Array(arcs.length);
  if (g.arcIdx) {
    for (let k = 0; k < g.shapes.length; k++) {
      if (g.shapes[k] !== SHAPE_ARC) continue;
      const i = k % g.w;
      const j = (k - i) / g.w;
      if (at(g, i, j) !== T_WALL) continue;
      const fi = g.arcIdx[k];
      if (fi >= 0 && fi < arcs.length) tilesPer[fi]++;
    }
  }
  for (let fi = 0; fi < arcs.length; fi++) {
    const f = arcs[fi];
    const ci = Math.round(f.cx);
    const cj = Math.round(f.cz);
    const backed = backedFraction(g, f);
    if (backed < 0.999) {
      push("arc-face", PIECE_RULES["arc-face"][0], ci, cj, `only ${(backed * 100).toFixed(0)}% of the span is backed`);
    }
    if (f.r * f.span < MIN_ARC_LEN) {
      push("arc-face", PIECE_RULES["arc-face"][1], ci, cj, `arc length ${(f.r * f.span).toFixed(2)} < ${MIN_ARC_LEN}`);
    }
    if (f.owner !== "island" && tilesPer[fi] < MIN_ARC_TILES) {
      push("arc-face", PIECE_RULES["arc-face"][2], ci, cj, `owns ${tilesPer[fi]} tiles`);
    }
    // A FULL CIRCLE's bands are strung around it from a rolled phase, so they
    // legitimately run past `a0 + span` and wrap — there is no "past the end"
    // on a closed curve. The containment rule only means anything on an arc.
    const closed = f.span >= Math.PI * 2 - 1e-6;
    const inSpan = (b: { a0: number; span: number }): boolean =>
      closed || (b.a0 >= f.a0 - 1e-6 && b.a0 + b.span <= f.a0 + f.span + 1e-6);
    for (const b of f.kicks ?? []) {
      if (!inSpan(b)) push("rubber", PIECE_RULES.rubber[0], ci, cj, "kick band runs past the arc it rides");
    }
    for (const b of f.lanes ?? []) {
      if (!inSpan(b)) push("rail", PIECE_RULES.rail[0], ci, cj, "lane band runs past the arc it rides");
      // ── WHERE THE RAIL PUTS YOU. Needs Φ, so it is skipped (not passed) on a
      // caller that did not supply it. `orientArcRails` is what makes these
      // hold; this is the gate that keeps it holding.
      if (!phi) continue;
      const x = railExit(g, f, b, b.cw);
      if (!x) {
        push("rail", PIECE_RULES.rail[1], ci, cj, "its exit is off the grid or against stone");
        continue;
      }
      const run = openRunway(g, x.i, x.j, x.di, x.dj, RAIL_MIN_RUNWAY);
      if (run < RAIL_MIN_RUNWAY) {
        push("rail", PIECE_RULES.rail[1], ci, cj, `${run} open tiles past the exit at (${x.i},${x.j}), wants ${RAIL_MIN_RUNWAY}`);
      }
      if (!isDownhill(g, phi, x.i, x.j, x.di, x.dj)) {
        push("rail", PIECE_RULES.rail[2], ci, cj, `exit (${x.i},${x.j}) throws (${x.di},${x.dj}), which is not down-Φ`);
      }
    }
  }
  for (const jn of findArcJunctions(g, true)) {
    push(
      "arc-face",
      PIECE_RULES["arc-face"][3],
      jn.i,
      jn.j,
      `${jn.check.reason} against feature ${jn.b} (kink ${((jn.check.kink * 180) / Math.PI).toFixed(0)}°, step ${jn.check.step.toFixed(2)})`,
    );
  }

  // ── Sealed lane (the launch chute) ─────────────────────────────────────
  if (mask) {
    for (let j = 1; j < g.h - 1; j++) {
      for (let i = 1; i < g.w - 1; i++) {
        if (mask.sealed[idx(g, i, j)] !== 1) continue;
        // A sealed tile may only open onto other lane tiles — never onto the
        // surrounding maze. That is what "sealed" means.
        for (const [di, dj] of SIDES) {
          const x = i + di;
          const y = j + dj;
          if (!isWalkable(g, x, y)) continue;
          if (mask.lane[idx(g, x, y)] === 1) continue;
          push("floor-sealed", PIECE_RULES["floor-sealed"][0], i, j, `opens onto off-lane floor at (${x},${y})`);
        }
      }
    }
  }

  // ── Furniture — the machine, judged on the FINISHED grid ───────────────
  //
  // Everything above judges walls. A shipping floor carries four to five times
  // as many parts as arc features, and none of them had ever been looked at
  // after placement: decorate validates topology when it places a part, and
  // then `openLaunchTargets` cracks walls, `carveDoorways` opens more and
  // `assignCornerShapes` reshapes them. This is the pass that asks afterwards.
  for (const p of content?.parts ?? []) {
    if (!isWalkable(g, p.i, p.j)) {
      push("furniture", PIECE_RULES.furniture[0], p.i, p.j, `${p.kind} stands on a wall tile`);
      continue;
    }
    // ── ONLY KINDS THAT ACTUALLY THROW, and each read on the leg it throws
    // along. Getting this wrong is not a near-miss, it INVENTS defects: a first
    // cut applied the runway test to every part carrying a cardinal and
    // reported 30/30 floors dirty, almost all of it `deflector` — whose `dirI`
    // is the leg the ball ARRIVES on, so "fires into stone" was measuring the
    // wall the deflector is BOLTED TO. `glove`, `oil`, `spinpad`, `mirror`,
    // `firevent` and friends carry a facing for orientation and do not launch
    // at all. A rule that fires on a population it does not understand is
    // wrong, not strict — the same lesson the socket table recorded for
    // `road|wall`. `exitRay` already knows the two-leg convention; THROWING is
    // the other half of the answer.
    if (!THROWING.has(p.kind)) continue;
    const [di, dj] = exitRay(p);
    if (Math.abs(di) + Math.abs(dj) !== 1) continue;
    // ⚠️ THE EXEMPTIONS ARE THE FEATURE, not gaps in the gate, and each one is
    // load-bearing enough that a previous wave broke the game by ignoring it:
    //   · a VAULT ramp is aimed at a wall band ON PURPOSE, to fling you over it
    //     (lifting this exemption silently turned every floor's jump shot into
    //     an ordinary dash pad);
    //   · a CHUTE pad's facing IS the plunger lane, sealed on both sides.
    if (p.vault || p.chute) continue;
    if (openRunway(g, p.i, p.j, di, dj, MIN_PART_RUNWAY) < MIN_PART_RUNWAY && at(g, p.i + di, p.j + dj) !== T_CRACKED) {
      push("furniture", PIECE_RULES.furniture[1], p.i, p.j, `${p.kind} fires (${di},${dj}) into stone within ${MIN_PART_RUNWAY} tiles`);
    }
    // A ROUTE part carries the floor's one-way structure and gets no kickback
    // allowance; a loose corridor part does (KICKBACK_CHANCE), so it is not
    // judged here. Requires Φ.
    if (phi && p.spine && !isDownhill(g, phi, p.i, p.j, di, dj)) {
      push("furniture", PIECE_RULES.furniture[2], p.i, p.j, `route ${p.kind} fires (${di},${dj}), which is not down-Φ`);
    }
  }

  return out;
}

/** Group violations by label for a readable failure message. */
export function summarise(v: readonly PieceViolation[]): string {
  const by = new Map<string, PieceViolation[]>();
  for (const x of v) {
    const key = `${x.label} — ${x.rule}`;
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(x);
  }
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, xs]) => `  ${xs.length}x ${key}\n      e.g. (${xs[0].i},${xs[0].j}) ${xs[0].detail}`)
    .join("\n");
}

/** Every tile piece's label — the counterpart of `socketAt` for whole pieces. */
export function pieceAt(g: Grid, mask: TrackMask | null, i: number, j: number): PieceLabel {
  const k = idx(g, i, j);
  if (at(g, i, j) === T_STAIRS) return "stairs";
  if (isWalkable(g, i, j)) {
    if (mask?.sealed[k] === 1) return "floor-sealed";
    if (mask?.lane[k] === 1) return "floor-road";
    return "floor-room";
  }
  if (at(g, i, j) === T_CRACKED) return "crack";
  if (g.shapes[k] === SHAPE_ARC) return "arc-face";
  if (g.shapes[k] !== SHAPE_FULL) return "wall-bevel";
  return "wall-box";
}

/** Convenience for tests/tools: how many of each piece a floor is made of. */
export function pieceCensus(g: Grid, mask: TrackMask | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const l = pieceAt(g, mask, i, j);
      out[l] = (out[l] ?? 0) + 1;
    }
  }
  out["arc-face(features)"] = g.arcs?.length ?? 0;
  return out;
}

/** Re-exported so callers can name a tile position without importing generator. */
export type { TilePos };
