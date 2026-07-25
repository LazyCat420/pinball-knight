/**
 * ARC LANES — the curved BOOSTER LANES set into the maze's swept walls.
 *
 * A kicker (render/arc-kickers.ts) is rubber: it THROWS the ball off the wall.
 * A lane is the opposite idea — a speed strip the ball RIDES, carrying it around
 * the bend and out along the curve. `maze/arc-sweeps.ts` authors them as
 * `LaneBand`s on concave sweeps (the inside of a bend); `collision.ts` reports
 * which lane owned a contact; `entities/player.ts` turns that into a tangential
 * launch. This module is the part you can SEE.
 *
 * Two deliberate visual departures from the rubber, both load-bearing:
 *
 *  1. ARCANE BLUE, not flame gold. A player has to tell at a glance whether a
 *     curve will bounce them or carry them, because the two demand opposite
 *     lines. Rubber owns the torch ramp (14-18); lanes own the cold arcane ramp
 *     (29-31). Palette-native either way — off-palette colours snap under the
 *     scene's quantise pass.
 *  2. CHEVRONS pointing the way the lane throws. A lane is ONE-WAY (a ball
 *     against the grain isn't grabbed at all), and nothing else in the geometry
 *     communicates direction — a bare glowing strip would read as symmetric and
 *     the player would keep taking it backwards and wondering why it was dead.
 *
 * Geometry is sampled from the SAME circle the collider uses, standing
 * ARC_LANE_THICK proud of the face, so the strip can never drift off the wall
 * the ball actually rides (the tile-shape see = hit contract).
 *
 * One owner ticks band cooldownT/hitT — here — and physics only ever stamps
 * them, exactly as updateArcKickers owns the rubber's clock.
 */
import * as THREE from "three";
import type { Grid } from "../maze/generator";
import type { ArcFeature, LaneBand } from "../maze/tile-shape";
import { PALETTE_HEX } from "./palette";
import { ARC_LANE_FLASH, ARC_LANE_THICK } from "../constants";

/** Lane bed: arcane dark, so the lit chevrons read as charge against it. */
const C_BED = PALETTE_HEX[29]; // arcane dark
/** Idle glow. The cold twin of the rubber's flame gold. */
const C_LIT = PALETTE_HEX[30]; // arcane mid
/** Boost flash — near-white cyan, blooms as the ball is swept away. */
const C_HOT = PALETTE_HEX[31]; // arcane light

/** One authored lane and the meshes drawing it. */
export interface ArcLaneVisual {
  band: LaneBand;
  /** The recessed bed and the chevrons riding it. Chevrons pulse ALONG the lane
   *  on a boost (they don't squash — a lane carries, it doesn't recoil). */
  mesh: THREE.Mesh;
  chevrons: THREE.Mesh;
  bedMat: THREE.MeshStandardMaterial;
  chevronMat: THREE.MeshStandardMaterial;
  /** Band mid-point in world coords (a spark/impact anchor for callers). */
  x: number;
  z: number;
}

/**
 * The lane BED: a curved slab hugging `f`'s face over [a0, a0+span], from y0 to
 * y1, sitting `off` outside the collider radius. Same construction as the
 * rubber's band (one circle, sampled), minus the top cap — a lane is set INTO
 * the wall rather than strapped onto it, so it wants no proud lip.
 */
function bedGeometry(cxw: number, czw: number, r: number, a0: number, span: number, y0: number, y1: number, off: number): THREE.BufferGeometry {
  const seg = Math.max(6, Math.ceil(span * r * 8));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const rr = r + off;
  for (let s = 0; s <= seg; s++) {
    const a = a0 + (span * s) / seg;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const x = cxw + dx * rr;
    const z = czw + dz * rr;
    pos.push(x, y0, z, x, y1, z);
    nor.push(dx, 0, dz, dx, 0, dz);
    const u = s / seg;
    uv.push(u, 0, u, 1);
  }
  for (let s = 0; s < seg; s++) {
    const v0 = s * 2;
    index.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** Chevrons per radian of arc — dense enough to read as flow, sparse enough
 *  that a short lane doesn't turn into a solid bar. */
const CHEVRONS_PER_RAD = 3.2;

/**
 * The DIRECTION MARKS: a run of >-shaped chevrons along the lane, apexes
 * pointing the way it throws. Built as one merged geometry (a lane is decor —
 * it must not cost a draw call per arrowhead).
 *
 * Each chevron is two quads meeting at an apex, drawn on the face at a small
 * radial offset so they sit just proud of the bed and catch the light.
 */
function chevronGeometry(
  cxw: number,
  czw: number,
  r: number,
  a0: number,
  span: number,
  y0: number,
  y1: number,
  off: number,
  cw: boolean,
): THREE.BufferGeometry {
  const n = Math.max(2, Math.round(span * CHEVRONS_PER_RAD));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const rr = r + off;
  // Angular half-width of one chevron, and the vertical span it occupies.
  const step = span / (n + 1);
  const half = Math.min(step * 0.34, 0.13);
  const yMid = (y0 + y1) / 2;
  const yHalf = (y1 - y0) * 0.3;

  for (let c = 1; c <= n; c++) {
    const aMid = a0 + step * c;
    // The apex leads in the throw direction; the tails trail behind it.
    const dir = cw ? 1 : -1;
    const aApex = aMid + half * dir;
    const aTail = aMid - half * dir;
    const at = (a: number, y: number): [number, number, number] => [cxw + Math.cos(a) * rr, y, czw + Math.sin(a) * rr];
    const apex = at(aApex, yMid);
    const top = at(aTail, yMid + yHalf);
    const bot = at(aTail, yMid - yHalf);
    // A thin V: apex → top tail, apex → bottom tail, given width by drawing each
    // arm as a quad between the tail and a point part-way back toward the apex.
    const midTop = at(aApex - half * dir * 0.45, yMid + yHalf * 0.42);
    const midBot = at(aApex - half * dir * 0.45, yMid - yHalf * 0.42);
    const base = pos.length / 3;
    for (const v of [apex, top, midTop, apex, bot, midBot]) pos.push(v[0], v[1], v[2]);
    for (let k = 0; k < 6; k++) {
      const a = k < 3 ? aApex : aTail;
      nor.push(Math.cos(a), 0, Math.sin(a));
      uv.push(0, 0);
    }
    index.push(base, base + 1, base + 2, base + 3, base + 5, base + 4);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Build the visible strip for every booster lane on the floor. `heightFor(fi)`
 * hands back the wall height the feature was drawn at, so a lane on a knee-high
 * camera-side sweep doesn't float above its own wall.
 *
 * Everything created here is returned in `disposables` — the maze handle owns
 * teardown, same as every other built asset.
 */
export function buildArcLanes(
  arcs: readonly ArcFeature[],
  grid: Grid,
  heightFor: (fi: number) => number,
): { group: THREE.Group; lanes: ArcLaneVisual[]; disposables: Array<{ dispose(): void }> } {
  const group = new THREE.Group();
  const lanes: ArcLaneVisual[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const wOff = grid.w / 2;
  const hOff = grid.h / 2;

  for (let fi = 0; fi < arcs.length; fi++) {
    const f = arcs[fi];
    if (!f.lanes || f.lanes.length === 0) continue;
    const h = heightFor(fi);
    const cxw = f.cx - wOff;
    const czw = f.cz - hOff;
    // A concave bowl is solid OUTSIDE its circle, so its face — and therefore
    // its lane — sits on the INSIDE. One sign flip covers both polarities.
    // (Lanes are authored concave-only today; the flip keeps it honest if that
    // ever changes.)
    const off = f.solidOut ? -ARC_LANE_THICK : ARC_LANE_THICK;
    // The lane runs LOW on the wall — it's a road surface, not a bumper. Sitting
    // it in the bottom half also keeps it clear of the rubber's 0.16–0.78 band
    // if a face ever wore both.
    const y0 = h * 0.1;
    const y1 = h * 0.52;

    for (const band of f.lanes) {
      const bedGeo = bedGeometry(cxw, czw, f.r, band.a0, band.span, y0, y1, off);
      const chevGeo = chevronGeometry(cxw, czw, f.r, band.a0, band.span, y0, y1, off * 1.6, band.cw);
      const bedMat = new THREE.MeshStandardMaterial({
        color: C_BED,
        emissive: C_LIT,
        emissiveIntensity: 0.22,
        roughness: 0.6,
        metalness: 0.15,
        side: THREE.DoubleSide,
      });
      const chevronMat = new THREE.MeshStandardMaterial({
        color: C_LIT,
        emissive: C_LIT,
        emissiveIntensity: 1.0,
        roughness: 0.35,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(bedGeo, bedMat);
      const chevrons = new THREE.Mesh(chevGeo, chevronMat);
      group.add(mesh, chevrons);
      disposables.push(bedGeo, chevGeo, bedMat, chevronMat);

      const mid = band.a0 + band.span / 2;
      lanes.push({
        band,
        mesh,
        chevrons,
        bedMat,
        chevronMat,
        x: cxw + Math.cos(mid) * (f.r + off),
        z: czw + Math.sin(mid) * (f.r + off),
      });
    }
  }
  return { group, lanes, disposables };
}

/**
 * Tick every lane's cooldown + flash and drive the look:
 *   idle  → chevrons pulse in a slow travelling wave (the lane advertises which
 *           way it runs even when nothing is on it)
 *   boost → the whole strip snaps hot and fades over ARC_LANE_FLASH
 *   spent → while cooldownT is live the lane visibly DIMS, so a player who
 *           doubles back can see it isn't ready rather than guessing
 * Cooldown is what physics reads, so it is ticked here whether or not the lane
 * has meshes (headless/disposed cases keep the same clock).
 */
export function updateArcLanes(lanes: readonly ArcLaneVisual[], dt: number, elapsed: number): void {
  for (const l of lanes) {
    const b = l.band;
    if (b.cooldownT > 0) b.cooldownT = Math.max(0, b.cooldownT - dt);
    if (b.hitT >= 0) b.hitT += dt;
    const t = b.hitT >= 0 && b.hitT < ARC_LANE_FLASH ? 1 - b.hitT / ARC_LANE_FLASH : 0;
    if (b.hitT >= ARC_LANE_FLASH) b.hitT = -1;

    if (t > 0) {
      l.chevronMat.color.setHex(C_HOT);
      l.chevronMat.emissive.setHex(C_HOT);
      l.chevronMat.emissiveIntensity = 1.0 + t * 3.2;
      l.bedMat.emissiveIntensity = 0.22 + t * 1.4;
    } else {
      // Dead lane reads dim; a live one breathes. The wave is a plain sine on
      // elapsed — chevron geometry is baked, so the travel is sold by the glow
      // rather than by moving anything.
      const spent = b.cooldownT > 0;
      const wave = 0.75 + Math.sin(elapsed * 3.6) * 0.25;
      l.chevronMat.color.setHex(C_LIT);
      l.chevronMat.emissive.setHex(C_LIT);
      l.chevronMat.emissiveIntensity = spent ? 0.18 : wave;
      l.bedMat.emissiveIntensity = spent ? 0.08 : 0.22;
    }
  }
}
