/**
 * LASER MARKS — the crossed sparks the ✨ laser stamps along its zigzag.
 *
 * These are geometry tests, and they exist because the failure this shape can
 * have is INVISIBLE to anything that only counts marks: a cross whose two arms
 * happen to lie in the ground plane projects, under the fixed iso camera, to a
 * flat smear that reads as a dash of the very beam the zigzag was built to
 * replace. "Some marks were spawned" would pass all the same.
 *
 * So the assertions are on the arms themselves: perpendicular, unit-length,
 * centred on the path point, and — the load-bearing one — never both flat,
 * whatever direction the ball is travelling and whatever roll the mark drew.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LaserMarkField } from "./vfx";

/** The live vertices, grouped four-at-a-time into (segment A, segment B). */
function arms(f: LaserMarkField): Array<{ a: THREE.Vector3; b: THREE.Vector3; mid: THREE.Vector3 }> {
  const seg = f.group.children[0] as THREE.LineSegments;
  const pos = seg.geometry.getAttribute("position") as THREE.BufferAttribute;
  const n = seg.geometry.drawRange.count;
  const out = [];
  for (let i = 0; i < n; i += 4) {
    const p0 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    const p1 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
    const p2 = new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
    const p3 = new THREE.Vector3(pos.getX(i + 3), pos.getY(i + 3), pos.getZ(i + 3));
    out.push({
      a: p1.clone().sub(p0),
      b: p3.clone().sub(p2),
      mid: p0.clone().add(p1).multiplyScalar(0.5),
    });
  }
  return out;
}

describe("LaserMarkField", () => {
  it("stamps a cross centred on the path point", () => {
    const f = new LaserMarkField();
    f.spawn(3, 0.45, -2, 1, 0, 0xffffff, 0.34);
    f.update(1 / 60);
    const [m] = arms(f);
    expect(m.mid.x).toBeCloseTo(3, 4);
    expect(m.mid.y).toBeCloseTo(0.45, 4);
    expect(m.mid.z).toBeCloseTo(-2, 4);
    f.dispose();
  });

  it("crosses the two arms — perpendicular, and neither collapsed", () => {
    const f = new LaserMarkField();
    // Sweep every travel direction; the roll is drawn at random per stamp, so
    // 40 of them covers the roll space too.
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      f.spawn(0, 0.45, 0, Math.cos(a), Math.sin(a), 0xffffff, 0.34);
    }
    f.update(1 / 60);
    const all = arms(f);
    expect(all.length).toBe(40);
    for (const m of all) {
      expect(m.a.length()).toBeGreaterThan(0.05);
      expect(m.b.length()).toBeGreaterThan(0.05);
      // Perpendicular: both arms are built in the (travel, up) plane, one
      // rolled off the other by 90°.
      expect(m.a.clone().normalize().dot(m.b.clone().normalize())).toBeCloseTo(0, 4);
    }
    f.dispose();
  });

  /**
   * THE ONE THAT MATTERS. The mark is built in the plane spanned by the ball's
   * travel direction and WORLD UP, so one arm is always climbing out of the
   * floor. Build it in the ground plane instead — the obvious choice — and
   * under this game's fixed iso camera the whole chain foreshortens into
   * horizontal dashes: a laser drawn as the sideways line it was meant to
   * replace.
   */
  it("always has an arm out of the ground plane, whatever the heading", () => {
    const f = new LaserMarkField();
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      f.spawn(0, 0.45, 0, Math.cos(a), Math.sin(a), 0xffffff, 0.34);
    }
    f.update(1 / 60);
    for (const m of arms(f)) {
      // Per arm, against its OWN length — the cross arm is drawn shorter, so
      // measuring its rise against the long arm would understate it.
      const rise = Math.max(Math.abs(m.a.y) / m.a.length(), Math.abs(m.b.y) / m.b.length());
      // Roll splits the vertical between the two arms as sin/cos, so the
      // better of the two is never under 1/√2 of its own length.
      expect(rise, "the cross went flat — it will read as a dash").toBeGreaterThan(0.7);
    }
    f.dispose();
  });

  it("expires marks and hides itself when the chain runs out", () => {
    const f = new LaserMarkField();
    f.spawn(0, 0.45, 0, 1, 0, 0xffffff, 0.34);
    f.update(1 / 60);
    expect((f.group.children[0] as THREE.LineSegments).visible).toBe(true);
    f.update(0.4); // past MARK_LIFE (0.3)
    expect((f.group.children[0] as THREE.LineSegments).visible).toBe(false);
    f.dispose();
  });

  it("clear() drops the chain immediately — a new cast starts empty", () => {
    const f = new LaserMarkField();
    for (let i = 0; i < 5; i++) f.spawn(i, 0.45, 0, 1, 0, 0xffffff, 0.34);
    f.update(1 / 60);
    expect(arms(f).length).toBe(5);
    f.clear();
    f.update(1 / 60);
    expect((f.group.children[0] as THREE.LineSegments).visible).toBe(false);
    f.dispose();
  });

  it("fades a mark toward black as it ages — the fade, under additive blending", () => {
    const f = new LaserMarkField();
    f.spawn(0, 0.45, 0, 1, 0, 0xffffff, 0.34);
    f.update(1 / 60);
    const seg = f.group.children[0] as THREE.LineSegments;
    const col = seg.geometry.getAttribute("color") as THREE.BufferAttribute;
    // The per-frame flicker is multiplicative on both samples, so compare the
    // same mark across a big age gap rather than two marks in one frame.
    const fresh = col.getX(0);
    f.update(0.2);
    const old = col.getX(0);
    expect(old).toBeLessThan(fresh);
    f.dispose();
  });
});
