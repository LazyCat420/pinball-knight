import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BladeRing, BLADE_SPINUP, trailGeometry } from "./blade-ring";

// A bare Texture stands in for the shard art: these tests are about MOTION, and
// the real one needs `document`. That the pool accepts one is the point — see
// the constructor's note.
const stubTex = (): THREE.Texture => new THREE.Texture();

/**
 * BLADE STORM's ring. The complaint that produced this file, from play: "some
 * that are just half circles spinning". It was three copies of the 223-degree
 * melee slash crescent orbited as rigid bodies.
 */

const C = 0xc8ccd4;
const R = 1.15; // BLADESTORM_RADIUS * 0.72

/** Drive the ring for `secs` at 60Hz, refreshing every frame like abilities.ts. */
function run(ring: BladeRing, secs: number, spin = 7.5): number {
  const dt = 1 / 60;
  let angle = 0;
  for (let f = 0; f < Math.round(secs / dt); f++) {
    angle += spin * dt;
    ring.refresh(0, 0.55, 0, angle, 3, R, C);
    ring.update(dt);
  }
  return angle;
}

const opacityOf = (o: THREE.Object3D): number => ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity;

describe("blade ring", () => {
  it("the trail tapers to nothing — head bright, tail black", () => {
    // Vertex colour, not opacity: under additive blending fading toward black IS
    // fading out, which is what gives a per-vertex falloff along the arc. If
    // this ever comes back uniform, the trail is a painted band again and we are
    // back to the crescent by another route.
    const g = trailGeometry();
    const col = g.getAttribute("color");
    const head = col.getX(0);
    const tail = col.getX(col.count - 1);
    expect(head).toBeGreaterThan(0.98);
    expect(tail).toBeLessThan(0.02);
    // Monotone all the way down, so there is no bright band floating mid-trail.
    let prev = Infinity;
    for (let i = 0; i < col.count; i += 2) {
      const b = col.getX(i);
      expect(b).toBeLessThanOrEqual(prev + 1e-6);
      prev = b;
    }
    g.dispose();
  });

  it("the trail NARROWS toward the tail", () => {
    // A constant-width arc reads as a painted band; a tapered one reads as a
    // wake. Measured as distance from the unit circle at head vs tail.
    const g = trailGeometry();
    const pos = g.getAttribute("position");
    const widthAt = (seg: number): number => {
      const i = seg * 2;
      const ri = Math.hypot(pos.getX(i), pos.getZ(i));
      const ro = Math.hypot(pos.getX(i + 1), pos.getZ(i + 1));
      return ro - ri;
    };
    expect(widthAt(0)).toBeGreaterThan(widthAt(20) * 2);
    g.dispose();
  });

  it("SHIMMER IS COHERENT — the glint is a wave, not per-frame noise", () => {
    // THE DEFECT THIS PINS. The old ring did `opacity = 0.7 + Math.random()*0.3`
    // and `scale = 0.9 + Math.random()*0.2` EVERY FRAME on a five-second object:
    // 300 uncorrelated samples per blade, which the eye reads as buzzing rather
    // than shimmer. The comment even claimed it was there so the ring "shimmers
    // instead of reading as a rigid decal".
    //
    // A coherent glint is bounded by its own rate: a sine of amplitude 0.22 at
    // 11 rad/s can move at most 0.22*11/60 = 0.040 per frame. Uniform noise of
    // width 0.3 has a mean absolute step of 0.1 and routinely exceeds 0.25, so
    // this threshold separates the two by a wide margin in both directions.
    const ring = new BladeRing(stubTex());
    run(ring, BLADE_SPINUP + 0.1); // past the spin-up, so `grow` is pinned at 1
    const dt = 1 / 60;
    let angle = 0;
    let prev = -1;
    let worst = 0;
    for (let f = 0; f < 120; f++) {
      angle += 7.5 * dt;
      ring.refresh(0, 0.55, 0, angle, 3, R, C);
      ring.update(dt);
      const o = opacityOf(ring.warmupTarget());
      if (prev >= 0) worst = Math.max(worst, Math.abs(o - prev));
      prev = o;
    }
    expect(worst).toBeLessThan(0.08);
    // ...and it must still MOVE. A constant is trivially coherent and is not a
    // shimmer; without this the test passes on `opacity = 0.9`.
    expect(worst).toBeGreaterThan(0.001);
    ring.dispose();
  });

  it("the ring flies OUT rather than popping in at full radius", () => {
    const ring = new BladeRing(stubTex());
    const dt = 1 / 60;
    let angle = 0;
    const radii: number[] = [];
    for (let f = 0; f < 30; f++) {
      angle += 7.5 * dt;
      ring.refresh(0, 0.55, 0, angle, 3, R, C);
      ring.update(dt);
      radii.push(Math.hypot(ring.warmupTarget().position.x, ring.warmupTarget().position.z));
    }
    // First frame is at the knight, not at the rim.
    expect(radii[0]).toBeLessThan(R * 0.5);
    // ...and it gets there.
    expect(radii[radii.length - 1]).toBeGreaterThan(R * 0.9);
    // Eased OUT, not linear: past halfway through the spin-up it is already more
    // than half the radius. `RingPool` uses the same 1-(1-t)^2 shape.
    const half = radii[Math.round((BLADE_SPINUP / 2) * 60)];
    expect(half).toBeGreaterThan(R * 0.5);
    ring.dispose();
  });

  it("it RETRACTS when the buff lapses instead of blinking out", () => {
    const ring = new BladeRing(stubTex());
    run(ring, 1.0);
    const lit = opacityOf(ring.warmupTarget());
    expect(lit).toBeGreaterThan(0.3);
    // Stop refreshing — the buff lapsed. Past the keep-alive hold it must fade,
    // and it must still be ON SCREEN partway through the retract.
    const dt = 1 / 60;
    for (let f = 0; f < 10; f++) ring.update(dt); // burn the 0.12s hold
    ring.update(dt);
    const mid = opacityOf(ring.warmupTarget());
    expect(mid).toBeLessThan(lit);
    expect(ring.warmupTarget().visible).toBe(true);
    for (let f = 0; f < 30; f++) ring.update(dt);
    expect(ring.warmupTarget().visible).toBe(false);
    ring.dispose();
  });

  it("draws no more than the blades asked for", () => {
    const ring = new BladeRing(stubTex());
    const dt = 1 / 60;
    // Past the spin-up: on frame 1 the radius is still 0 and the trails are
    // legitimately hidden, so counting there would pin the wrong thing.
    run(ring, BLADE_SPINUP + 0.1);
    ring.refresh(0, 0.55, 0, 0, 3, R, C);
    ring.update(dt);
    const shown = ring.group.children.filter((c) => c.visible).length;
    expect(shown).toBe(6); // 3 blades x (shard + trail), 6 slots allocated
    ring.dispose();
  });
});
