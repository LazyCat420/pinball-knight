/**
 * TRAIL RIBBON — the ring buffer behind the ricochet forms' streak.
 *
 * Written after the first implementation rewound the WRITE CURSOR when old
 * points expired (`head = start + live.length`). Points die from the oldest end
 * only, so the survivors are the newest N and `head` must stay put; moving it
 * back put the cursor inside the live range, and subsequent pushes overwrote
 * the trail's own tail. On a short trail that is invisible. On a long one it
 * corrupts the path into a zig-zag between two eras of the ball's travel — and
 * since this ribbon is what carries the form's DIRECTION, a corrupt path is a
 * lie about where the player is going.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { TrailRibbon } from "../system";

/** The live vertex positions of the core strand, in path order. */
function corePath(t: TrailRibbon): Array<[number, number]> {
  const line = t.group.children[0] as THREE.Line;
  const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  const n = line.geometry.drawRange.count;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) out.push([pos.getX(i), pos.getZ(i)]);
  return out;
}

describe("TrailRibbon", () => {
  it("draws the pushed points in path order", () => {
    const t = new TrailRibbon();
    for (let i = 0; i < 6; i++) t.push(i, 0.5, 0, 0xff0000);
    t.update(1 / 60);
    const path = corePath(t);
    expect(path.length).toBe(6);
    // Monotonic in x — the order points were pushed in.
    for (let i = 1; i < path.length; i++) expect(path[i][0]).toBeGreaterThan(path[i - 1][0]);
    t.dispose();
  });

  it("expires the oldest points, shortening the tail from the back", () => {
    const t = new TrailRibbon();
    t.push(0, 0.5, 0, 0xff0000);
    t.push(1, 0.5, 0, 0xff0000);
    // Age those two most of the way out, then add fresh ones.
    t.update(0.4);
    t.push(2, 0.5, 0, 0xff0000);
    t.push(3, 0.5, 0, 0xff0000);
    t.update(0.1); // first two now past TRAIL_LIFE (0.45)
    const path = corePath(t);
    expect(path.length).toBe(2);
    // The SURVIVORS are the newest, and the head is still the last thing pushed.
    expect(path[0][0]).toBeCloseTo(2, 5);
    expect(path[1][0]).toBeCloseTo(3, 5);
    t.dispose();
  });

  /**
   * THE REGRESSION. Run far more pushes than the buffer holds, with expiries
   * interleaved, and require the path to stay monotonic. A rewound write cursor
   * shows up here as a point that jumps backwards.
   */
  it("never overwrites live points, however long it runs", () => {
    const t = new TrailRibbon();
    let x = 0;
    for (let step = 0; step < 500; step++) {
      // Three pushes per frame, matching the form's substepping.
      for (let s = 0; s < 3; s++) t.push((x += 0.1), 0.5, 0, 0xff0000);
      t.update(1 / 60);
      const path = corePath(t);
      for (let i = 1; i < path.length; i++) {
        expect(path[i][0], `path went backwards at step ${step}, vertex ${i}`).toBeGreaterThan(path[i - 1][0]);
      }
      // The head is always the newest point pushed. Compare in FLOAT32:
      // positions live in a BufferAttribute, so by x≈128 the stored value is
      // further from the float64 `x` than a 5-decimal tolerance allows. That is
      // the buffer's precision, not a lag.
      expect(path[path.length - 1][0], `head lagged the ball at step ${step}`).toBeCloseTo(Math.fround(x), 3);
    }

    // THE ASSERTION THAT ACTUALLY CATCHES THE CURSOR BUG, arrived at by
    // measuring both versions rather than reasoning about them.
    //
    // Neither ordering nor the head position separates fixed from broken: with
    // the cursor rewound the ribbon still draws in order and still ends at the
    // ball. What it loses is LENGTH — measured, 3 points spanning 0.2 units
    // against 78 spanning 7.7. In game that is not a corrupt trail, it is no
    // trail: the streak the whole feature exists for silently becomes a dot.
    //
    // At 3 pushes/frame with TRAIL_LIFE 0.45s the steady state is ~81 points,
    // so anything under half that means points are being destroyed early.
    const path = corePath(t);
    expect(path.length, "the ribbon collapsed — points are dying early").toBeGreaterThan(40);
    expect(path[path.length - 1][0] - path[0][0], "the ribbon has no length").toBeGreaterThan(3);
    t.dispose();
  });

  it("clear() drops the tail immediately", () => {
    const t = new TrailRibbon();
    for (let i = 0; i < 8; i++) t.push(i, 0.5, 0, 0xff0000);
    t.update(1 / 60);
    expect(corePath(t).length).toBe(8);
    t.clear();
    t.update(1 / 60);
    expect((t.group.children[0] as THREE.Line).visible).toBe(false);
    t.dispose();
  });

  it("hides itself below two points — a one-point line is not a line", () => {
    const t = new TrailRibbon();
    t.push(0, 0.5, 0, 0xff0000);
    t.update(1 / 60);
    expect((t.group.children[0] as THREE.Line).visible).toBe(false);
    t.dispose();
  });

  it("fades the tail toward black, which IS the fade under additive blending", () => {
    const t = new TrailRibbon();
    t.push(0, 0.5, 0, 0xffffff);
    t.update(0.3); // age the first point most of the way out
    t.push(1, 0.5, 0, 0xffffff);
    t.update(1 / 60);
    const line = t.group.children[0] as THREE.Line;
    const col = line.geometry.getAttribute("color") as THREE.BufferAttribute;
    // Vertex 0 is the OLD point, vertex 1 the fresh head.
    expect(col.getX(0)).toBeLessThan(col.getX(1));
    t.dispose();
  });
});
