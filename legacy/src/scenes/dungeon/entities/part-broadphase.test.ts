import { describe, it, expect } from "vitest";
import {
  PART_TOUCH_BROAD,
  PART_ANIM_RANGE,
  MAGNET_PULL_RANGE,
  VENT_LANE_LEN,
  GLOVE_LANE_LEN,
  OIL_SLICK_RADIUS,
  BUMPER_RADIUS,
  BOOSTER_RADIUS,
  TARGET_RADIUS,
  FLIPPER_RADIUS,
  MIRROR_RADIUS,
  MAGSTRIP_RADIUS,
  ROLLOVER_RADIUS,
  PIT_RADIUS,
  SHOT_LIGHT_RANGE,
  VIEW_W,
  VIEW_H,
} from "../constants";

/**
 * These pin the SAFETY relationship behind two distance gates added for
 * performance. Both gates are only sound while they sit clear of the reaches
 * they are allowed to skip, and both would fail SILENTLY if that stopped being
 * true — parts quietly not firing, or animations quietly popping in. A future
 * part with a longer reach must break this suite, not the game.
 */
describe("part broad-phase is safely wider than every trigger reach", () => {
  // Every per-part reach that touchPinballParts' handlers test against.
  const REACHES: ReadonlyArray<readonly [string, number]> = [
    ["MAGNET_PULL_RANGE", MAGNET_PULL_RANGE],
    ["VENT_LANE_LEN", VENT_LANE_LEN],
    ["GLOVE_LANE_LEN", GLOVE_LANE_LEN],
    ["OIL_SLICK_RADIUS", OIL_SLICK_RADIUS],
    ["BUMPER_RADIUS", BUMPER_RADIUS],
    ["BOOSTER_RADIUS", BOOSTER_RADIUS],
    ["TARGET_RADIUS", TARGET_RADIUS],
    ["FLIPPER_RADIUS", FLIPPER_RADIUS],
    ["MIRROR_RADIUS", MIRROR_RADIUS],
    ["MAGSTRIP_RADIUS", MAGSTRIP_RADIUS],
    ["ROLLOVER_RADIUS", ROLLOVER_RADIUS],
    ["PIT_RADIUS", PIT_RADIUS],
  ];

  it("clears the largest part reach with real headroom", () => {
    for (const [name, reach] of REACHES) {
      expect(reach, `${name} must stay under the broad-phase cutoff`).toBeLessThan(PART_TOUCH_BROAD);
    }
  });

  it("keeps at least 2x margin over the worst case", () => {
    // Not merely "bigger" — comfortably bigger, so a modest tuning bump to a
    // part's reach cannot creep past the gate unnoticed.
    const worst = Math.max(...REACHES.map(([, r]) => r));
    expect(PART_TOUCH_BROAD).toBeGreaterThanOrEqual(worst * 2);
  });
});

describe("part animation range covers what the player can actually see", () => {
  it("exceeds the camera's half-diagonal", () => {
    // A part inside the view must animate. The camera shows VIEW_W x VIEW_H
    // tiles centred on the knight, so the furthest visible point is the corner.
    const halfDiag = Math.hypot(VIEW_W / 2, VIEW_H / 2);
    expect(PART_ANIM_RANGE).toBeGreaterThan(halfDiag);
  });

  it("exceeds the lit-shot range", () => {
    // The "shoot HERE" light reaches SHOT_LIGHT_RANGE down a lane. If the
    // animation gate were tighter, the light would pop in as you approached.
    expect(PART_ANIM_RANGE).toBeGreaterThan(SHOT_LIGHT_RANGE);
  });

  it("is wider than the collision broad-phase", () => {
    // You must be able to SEE a part before you can touch it. If this ever
    // inverted, a part would fire while still visually inert.
    expect(PART_ANIM_RANGE).toBeGreaterThan(PART_TOUCH_BROAD);
  });
});
