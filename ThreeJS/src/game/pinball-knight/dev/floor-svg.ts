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
}

/** Part families, by what the player does with them. Colour follows FUNCTION,
 *  never kind, so a floor with six launcher kinds still reads as "one job". */
const FAMILY: Record<PartSpotKind, "launch" | "bounce" | "bank" | "hazard" | "score"> = {
  booster: "launch",
  boostcorner: "launch",
  boostcurve: "launch",
  jumppad: "launch",
  spring: "launch",
  ramp: "launch",
  flipper: "launch",
  slingshot: "bounce",
  bumper: "bounce",
  deflector: "bank",
  mirror: "bank",
  glove: "bank",
  spinpad: "score",
  target: "score",
  rollover: "score",
  lamp: "score",
  magstrip: "score",
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
