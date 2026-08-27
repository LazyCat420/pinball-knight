/**
 * PINBALL AIM INDICATOR — the "which way am I going?" readout.
 *
 * Marble mode steers with the mouse, but PINBALL_STEER only BENDS the momentum
 * (it's a physics roll, not a walk), so where you point and where you actually
 * travel are two different vectors. Flying by feel means guessing the gap
 * between them. This draws both, on the ground, in the ball's own space:
 *
 *   HEADING  — a solid arrow along the CURRENT momentum. Where you ARE going.
 *   STEER    — a dashed arrow toward the CURSOR. Where you're PULLING.
 *   BEND     — an arc between them, filling in as the two diverge, so the
 *              "how hard am I turning" is legible at a glance.
 *
 * Ground-plane quads rather than a HUD overlay: the ride is read in world
 * space, and a screen-space arrow would fight the isometric projection the
 * whole rest of the game is drawn in. Everything lives in ONE group that is
 * hidden outright when the knight isn't rolling, so the normal walking game is
 * visually untouched.
 *
 * Pure geometry lives in aim-indicator-math.ts so it can be tested without a
 * GL context — this file is the THREE plumbing only.
 */
import * as THREE from "three";
import { bendFraction, steerSign } from "./aim-indicator-math";

/** Y height of the ground decal — just above the floor, under the sprites. */
const Y = 0.06;

export interface AimIndicator {
  group: THREE.Group;
  /**
   * Point the indicator. `momX/momZ` is the unit momentum, `steer` the unit
   * steer direction (or null when nothing is steering), `speed` the current
   * momSpeed and `maxSpeed` what counts as "flat out" for the length ramp.
   */
  update(
    px: number,
    pz: number,
    momX: number,
    momZ: number,
    steer: { x: number; z: number } | null,
    speed: number,
    maxSpeed: number,
    opposition?: number,
  ): void;
  /** Hide the whole thing (not rolling / menu open / headless). */
  hide(): void;
  dispose(): void;
}

/** A flat arrow built once in +X and re-oriented per frame by rotating Y. */
function makeArrow(color: number, opacity: number, dashed: boolean): THREE.Mesh {
  const shaft = 0.62;
  const half = 0.055;
  const headL = 0.26;
  const headHalf = 0.15;
  const g = new THREE.BufferGeometry();
  // Shaft as two triangles + a head triangle, all in the XZ plane at y=0.
  const v: number[] = [];
  const seg = dashed ? 4 : 1; // a dashed arrow is the shaft cut into pieces
  const gap = dashed ? 0.45 : 0;
  const segLen = (shaft / seg) * (1 - gap);
  for (let i = 0; i < seg; i++) {
    const x0 = (shaft / seg) * i;
    const x1 = x0 + segLen;
    v.push(x0, 0, -half, x1, 0, -half, x1, 0, half);
    v.push(x0, 0, -half, x1, 0, half, x0, 0, half);
  }
  v.push(shaft, 0, -headHalf, shaft + headL, 0, 0, shaft, 0, headHalf);
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 3;
  return mesh;
}

/** The bend wedge: a ring sector rebuilt each frame between the two headings. */
function makeBend(color: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9 * 32), 3));
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 2;
  return mesh;
}

export function createAimIndicator(): AimIndicator {
  const group = new THREE.Group();
  group.visible = false;

  const heading = makeArrow(0xffd479, 0.95, false); // gold — where you're going
  const steerArrow = makeArrow(0x6fd0e8, 0.8, true); // cyan — where you're pulling
  const bend = makeBend(0x6fd0e8);
  group.add(bend, steerArrow, heading);

  const bendPos = bend.geometry.getAttribute("position") as THREE.BufferAttribute;

  function writeBend(fromAng: number, toAng: number, radius: number, frac: number): void {
    const arr = bendPos.array as Float32Array;
    const steps = 30;
    // Sweep the SHORT way round, scaled by how much bend to reveal.
    let d = toAng - fromAng;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    d *= frac;
    const inner = radius * 0.72;
    let o = 0;
    for (let i = 0; i < steps; i++) {
      const a0 = fromAng + (d * i) / steps;
      const a1 = fromAng + (d * (i + 1)) / steps;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      // Two triangles per step forming the ring band.
      arr[o++] = c0 * inner; arr[o++] = 0; arr[o++] = s0 * inner;
      arr[o++] = c1 * inner; arr[o++] = 0; arr[o++] = s1 * inner;
      arr[o++] = c1 * radius; arr[o++] = 0; arr[o++] = s1 * radius;
      arr[o++] = c0 * inner; arr[o++] = 0; arr[o++] = s0 * inner;
      arr[o++] = c1 * radius; arr[o++] = 0; arr[o++] = s1 * radius;
      arr[o++] = c0 * radius; arr[o++] = 0; arr[o++] = s0 * radius;
    }
    while (o < arr.length) arr[o++] = 0;
    bendPos.needsUpdate = true;
  }

  return {
    group,
    update(px, pz, momX, momZ, steer, speed, maxSpeed, opposition = 0) {
      group.visible = true;
      group.position.set(px, Y, pz);

      // THREE rotates about +Y; an arrow built along +X points at world angle
      // atan2(z, x), and rotation.y is the NEGATIVE of that.
      const momAng = Math.atan2(momZ, momX);
      heading.rotation.y = -momAng;
      // Faster ride = longer arrow, so speed is readable without a number.
      const t = Math.max(0, Math.min(1, maxSpeed > 0 ? speed / maxSpeed : 0));
      const len = 0.85 + t * 0.75;
      heading.scale.set(len, 1, 1);

      if (steer) {
        const steerAng = Math.atan2(steer.z, steer.x);
        steerArrow.visible = true;
        steerArrow.rotation.y = -steerAng;
        steerArrow.scale.set(0.9, 1, 1);
        if (opposition > 0.35) {
          (steerArrow.material as THREE.MeshBasicMaterial).color.setHex(0xffaa44);
        } else {
          (steerArrow.material as THREE.MeshBasicMaterial).color.setHex(0x6fd0e8);
        }
        const frac = bendFraction(momX, momZ, steer.x, steer.z);
        if (frac > 0.02) {
          bend.visible = true;
          // Wedge sits between the two, at the arrowheads' radius.
          writeBend(momAng, steerAng, len * 0.72, 1);
          // Stronger tint the harder the turn — the "am I fighting it" cue.
          (bend.material as THREE.MeshBasicMaterial).opacity = 0.18 + frac * 0.34;
          // steerSign only drives colour: left/right turns read differently, hard carve warms to amber.
          if (opposition > 0.35) {
            (bend.material as THREE.MeshBasicMaterial).color.setHex(0xffaa44);
          } else {
            (bend.material as THREE.MeshBasicMaterial).color.setHex(
              steerSign(momX, momZ, steer.x, steer.z) >= 0 ? 0x6fd0e8 : 0xb06fe8,
            );
          }
        } else {
          bend.visible = false;
        }
      } else {
        steerArrow.visible = false;
        bend.visible = false;
      }
    },
    hide() {
      group.visible = false;
    },
    dispose() {
      group.visible = false;
      for (const m of [heading, steerArrow, bend]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      group.clear();
    },
  };
}
