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
  | "stairs";

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
  rail: ["angular range lies inside the owning arc-face's span"],
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
};

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Check every piece on a finished floor against its rules.
 *
 * `mask` is optional: without it the road/sealed rules are skipped (a legacy
 * floor has no circuit), everything else still runs.
 */
export function checkPieces(g: Grid, mask?: TrackMask | null): PieceViolation[] {
  const out: PieceViolation[] = [];
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
        // A crack must have open floor on opposite sides — that is what makes
        // smashing it a shortcut rather than a hole into the same room.
        const ns = SIDES.filter(([di, dj]) => isWalkable(g, i + di, j + dj)).length;
        if (ns === 0) push("crack", PIECE_RULES.crack[0], i, j, "sealed on all four sides");
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
