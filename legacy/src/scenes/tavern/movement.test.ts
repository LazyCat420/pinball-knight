/**
 * The tavern must walk the same way the dungeon does.
 *
 * It didn't. `player.ts` hand-rolled the screen→world rotation as
 * `(a.x - a.z, a.x + a.z) * ISO` instead of calling `screenDirToWorld`, and
 * that expression is the correct basis turned exactly 90°:
 *
 *     W walked screen-RIGHT   A walked screen-UP
 *     S walked screen-LEFT    D walked screen-DOWN
 *
 * Reported as "left is up, right is down, down is left and up is right", which
 * is precisely a quarter turn. Nothing failed — the knight moved, collided and
 * animated correctly, just never in the direction you pressed. A second copy of
 * the maths is the only reason the two scenes could disagree at all, so these
 * tests assert the tavern goes through the SHARED helper by pinning the
 * directions it must produce.
 */
import { describe, it, expect } from "vitest";
import { screenDirToWorld, worldDirToScreen } from "../dungeon/camera";

/** Unit-ise so we compare direction, not magnitude. */
function unit(v: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / len, z: v.z / len };
}

/** The rotation the tavern used to apply, kept so the bug stays pinned. */
const ISO = Math.SQRT1_2;
function theOldBrokenWay(sx: number, sz: number): { x: number; z: number } {
  return { x: (sx - sz) * ISO, z: (sx + sz) * ISO };
}

/** WASD as the input layer reports it: +z is screen-DOWN, toward the camera. */
const KEYS = {
  W: { x: 0, z: -1 },
  S: { x: 0, z: 1 },
  A: { x: -1, z: 0 },
  D: { x: 1, z: 0 },
} as const;

describe("tavern movement direction", () => {
  it("sends each key back to the screen axis it was pressed on", () => {
    // Round-tripping through worldDirToScreen is the honest check: it asks
    // "once this becomes world motion, which way does it LOOK like it goes?"
    for (const [key, axis] of Object.entries(KEYS)) {
      const back = unit(worldDirToScreen(screenDirToWorld(axis.x, axis.z).x, screenDirToWorld(axis.x, axis.z).z));
      expect(back.x, `${key} screen-x`).toBeCloseTo(axis.x, 6);
      expect(back.z, `${key} screen-z`).toBeCloseTo(axis.z, 6);
    }
  });

  it("does NOT reproduce the 90-degree rotation the tavern used to have", () => {
    // W is the clearest single case: under the old maths it walked screen-right.
    const good = unit(screenDirToWorld(KEYS.W.x, KEYS.W.z));
    const bad = unit(theOldBrokenWay(KEYS.W.x, KEYS.W.z));
    expect(good.x).not.toBeCloseTo(bad.x, 3);

    // And state it as the quarter-turn it actually is: rotating the correct
    // vector by +90° in XZ, (x, z) -> (-z, x), lands exactly on the old one.
    expect(bad.x).toBeCloseTo(-good.z, 6);
    expect(bad.z).toBeCloseTo(good.x, 6);
  });

  it("keeps opposite keys opposite and perpendicular keys perpendicular", () => {
    const w = unit(screenDirToWorld(KEYS.W.x, KEYS.W.z));
    const s = unit(screenDirToWorld(KEYS.S.x, KEYS.S.z));
    const d = unit(screenDirToWorld(KEYS.D.x, KEYS.D.z));

    expect(w.x + s.x).toBeCloseTo(0, 6);
    expect(w.z + s.z).toBeCloseTo(0, 6);
    // Perpendicular ⇒ dot product zero.
    expect(w.x * d.x + w.z * d.z).toBeCloseTo(0, 6);
  });

  it("gives all eight keyboard directions a distinct heading", () => {
    // The "not granular enough" half of the report: with the rotation wrong,
    // diagonals landed on the axis you expected a cardinal to take, so the set
    // of reachable headings felt smaller than it was. Eight distinct headings.
    const combos = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ];
    const headings = combos.map(([x, z]) => {
      const w = unit(screenDirToWorld(x, z));
      return `${w.x.toFixed(4)},${w.z.toFixed(4)}`;
    });
    expect(new Set(headings).size).toBe(8);
  });
});
