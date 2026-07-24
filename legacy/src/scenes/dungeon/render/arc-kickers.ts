/**
 * ARC KICKERS — the booster rubber strapped to the curved maze walls.
 *
 * A real table doesn't leave its sweeping ball-guides bare: the live stretches
 * wear rubber, and the ball is THROWN off them rather than merely returned.
 * `maze/arc-sweeps.ts` authors those stretches as `KickBand`s (an angular
 * sub-span of an `ArcFeature`); `collision.ts` reports which band owned a
 * contact; `entities/player.ts` turns that into the kick. This module is the
 * part you can SEE.
 *
 * Geometry is sampled from the SAME circle the collider uses — the band just
 * stands `ARC_KICK_THICK` proud of the face, on the OPEN side — so the rubber
 * can never drift off the wall the ball actually rides (the tile-shape
 * see = hit contract, applied to a decoration).
 *
 * Each band is its own small mesh (a floor carries ≤ ARC_KICK_MAX of them), so
 * a single kick can flash a single band. One owner ticks band cooldownT/hitT
 * here — exactly like updatePinballParts owns part timers — and the physics
 * code only ever stamps them.
 */
import * as THREE from "three";
import type { Grid } from "../maze/generator";
import type { ArcFeature, KickBand } from "../maze/tile-shape";
import { PALETTE_HEX } from "./palette";
import { ARC_KICK_FLASH, ARC_KICK_THICK } from "../constants";

/** Rubber body: blood-dark, so the lit accents read as heat against it. */
const C_RUBBER = PALETTE_HEX[11]; // blood dark
/** Idle glow + the flash colour. Palette-native (off-palette snaps elsewhere). */
const C_LIT = PALETTE_HEX[16]; // flame — the machine's "live part" gold
const C_HOT = PALETTE_HEX[18]; // flame core — near-white, blooms on the kick

/** One authored band and the meshes drawing it. */
export interface ArcKickerVisual {
  band: KickBand;
  /** The rubber body and its bright top rail — both compress on a kick, so the
   *  rail never detaches from the slab it caps. */
  mesh: THREE.Mesh;
  rail: THREE.Mesh;
  railMat: THREE.MeshStandardMaterial;
  bodyMat: THREE.MeshStandardMaterial;
  /** Band mid-point in world coords (a spark/impact anchor for callers). */
  x: number;
  z: number;
}

/**
 * A curved slab hugging `f`'s face over [a0, a0+span]: a vertical band from
 * y0 to y1 sitting `off` outside the collider radius, capped along its top.
 * Built in world coords (grid centres already baked in by the caller).
 */
function bandGeometry(cxw: number, czw: number, r: number, a0: number, span: number, y0: number, y1: number, off: number): THREE.BufferGeometry {
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
  // Top cap, from the face back onto the wall, so the slab doesn't read hollow.
  const capBase = pos.length / 3;
  for (let s = 0; s <= seg; s++) {
    const a = a0 + (span * s) / seg;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    pos.push(cxw + dx * r, y1, czw + dz * r, cxw + dx * rr, y1, czw + dz * rr);
    nor.push(0, 1, 0, 0, 1, 0);
    const u = s / seg;
    uv.push(u, 0, u, 1);
  }
  for (let s = 0; s < seg; s++) {
    const v0 = capBase + s * 2;
    index.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/**
 * Build the visible rubber for every kicker band on the floor. `heightFor(fi)`
 * hands back the wall height the feature was drawn at, so a band on a knee-high
 * camera-side sweep doesn't float above its own wall.
 *
 * Everything created here is returned in `disposables` — the maze handle owns
 * teardown, same as every other built asset.
 */
export function buildArcKickers(
  arcs: readonly ArcFeature[],
  grid: Grid,
  heightFor: (fi: number) => number,
): { group: THREE.Group; kickers: ArcKickerVisual[]; disposables: Array<{ dispose(): void }> } {
  const group = new THREE.Group();
  const kickers: ArcKickerVisual[] = [];
  const disposables: Array<{ dispose(): void }> = [];
  const wOff = grid.w / 2;
  const hOff = grid.h / 2;

  for (let fi = 0; fi < arcs.length; fi++) {
    const f = arcs[fi];
    if (!f.kicks || f.kicks.length === 0) continue;
    const h = heightFor(fi);
    const cxw = f.cx - wOff;
    const czw = f.cz - hOff;
    // A concave bowl is solid OUTSIDE its circle, so its face — and therefore
    // its rubber — sits on the INSIDE. One sign flip covers both polarities.
    const off = f.solidOut ? -ARC_KICK_THICK : ARC_KICK_THICK;
    // Rubber wraps the lower two-thirds of the wall, clear of the floor line.
    const y0 = h * 0.16;
    const y1 = h * 0.78;

    for (const band of f.kicks) {
      const bodyGeo = bandGeometry(cxw, czw, f.r, band.a0, band.span, y0, y1, off);
      const railGeo = bandGeometry(cxw, czw, f.r, band.a0, band.span, y1, y1 + 0.055, off * 1.25);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: C_RUBBER,
        emissive: C_LIT,
        emissiveIntensity: 0.18,
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const railMat = new THREE.MeshStandardMaterial({
        color: C_LIT,
        emissive: C_LIT,
        emissiveIntensity: 0.9,
        roughness: 0.4,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(bodyGeo, bodyMat);
      const rail = new THREE.Mesh(railGeo, railMat);
      mesh.castShadow = true;
      group.add(mesh, rail);
      disposables.push(bodyGeo, railGeo, bodyMat, railMat);

      const mid = band.a0 + band.span / 2;
      kickers.push({
        band,
        mesh,
        rail,
        railMat,
        bodyMat,
        x: cxw + Math.cos(mid) * (f.r + off),
        z: czw + Math.sin(mid) * (f.r + off),
      });
    }
  }
  return { group, kickers, disposables };
}

/**
 * Tick every band's cooldown + hit flash and drive the look:
 *   idle → a slow shared breathe on the rail (the table is alive)
 *   hit  → rail snaps white-hot and the body squashes INTO the wall, then both
 *          ease back over ARC_KICK_FLASH — the recoil that sells the throw.
 * Cooldown is what physics reads, so it is ticked here whether or not the band
 * has meshes (headless/disposed cases keep the same clock).
 */
export function updateArcKickers(kickers: readonly ArcKickerVisual[], dt: number, elapsed: number): void {
  const breathe = 0.72 + Math.sin(elapsed * 2.4) * 0.18;
  for (const k of kickers) {
    const b = k.band;
    if (b.cooldownT > 0) b.cooldownT = Math.max(0, b.cooldownT - dt);
    if (b.hitT >= 0) b.hitT += dt;
    const t = b.hitT >= 0 && b.hitT < ARC_KICK_FLASH ? 1 - b.hitT / ARC_KICK_FLASH : 0;
    if (t > 0) {
      k.railMat.color.setHex(C_HOT);
      k.railMat.emissive.setHex(C_HOT);
      k.railMat.emissiveIntensity = 0.9 + t * 2.6;
      k.bodyMat.emissiveIntensity = 0.18 + t * 1.1;
      // The recoil. The band's geometry is baked in WORLD coords (it wraps a
      // circle centred somewhere else entirely), so an in-plane squash toward
      // the arc centre isn't a mesh scale — scaling Y about the floor line is,
      // and a rubber strip visibly crushing down and springing back is the read
      // we want anyway. Body and rail scale together or the cap floats off.
      const squash = 1 - t * 0.28;
      k.mesh.scale.y = squash;
      k.rail.scale.y = squash;
    } else {
      if (b.hitT >= ARC_KICK_FLASH) b.hitT = -1;
      k.railMat.color.setHex(C_LIT);
      k.railMat.emissive.setHex(C_LIT);
      k.railMat.emissiveIntensity = breathe;
      k.bodyMat.emissiveIntensity = 0.18;
      k.mesh.scale.y = 1;
      k.rail.scale.y = 1;
    }
  }
}
