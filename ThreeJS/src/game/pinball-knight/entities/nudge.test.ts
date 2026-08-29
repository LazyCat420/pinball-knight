/**
 * THE NUDGE AND THE TILT.
 *
 * The thing worth pinning here is the PRICE. A nudge that bends the heading is
 * easy; a nudge that is strictly better than steering is a bug, and the only
 * thing standing between the two is the meter. So most of this file is about
 * the meter, the lockout, and the fact that the penalty actually lands.
 *
 * No rendering and no audio (house rule): `state.vfx` is left null so the
 * optional-chained calls no-op, and sfx are fail-silent without an
 * AudioContext.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { nudgeTable, updateTilt, resetTilt, tiltLevel, tiltLockRemaining } from "./nudge";
import { NUDGE_BEND, NUDGE_COOLDOWN, NUDGE_SPEED_ADD, TILT_PER_NUDGE, TILT_DECAY, TILT_LOCKOUT } from "../constants";

/** Put the knight on a heading of +x at `speed`, riding. */
function riding(speed = 10): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
  const p = state.player!;
  p.momX = 1;
  p.momZ = 0;
  p.momSpeed = speed;
}

/**
 * `n` shoves at the FASTEST rate the game allows — one every NUDGE_COOLDOWN.
 *
 * The tick goes BEFORE each shove but not after the last one, so the meter is
 * read at the moment the final shove lands rather than a frame of decay later.
 * That spacing is the whole point: the meter drains between shoves, so what
 * decides a tilt is the NET gain per shove, not the cost of one.
 */
function shove(n: number, dx = 0, dz = 1): number {
  let landed = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0) updateTilt(NUDGE_COOLDOWN);
    if (nudgeTable(dx, dz)) landed++;
  }
  return landed;
}

beforeEach(() => {
  resetTilt();
  state.partComboHits = 0;
  state.shotChain = [];
  state.vfx = null as unknown as typeof state.vfx;
  riding();
});

describe("the shove", () => {
  it("rotates the heading toward the push by a FIXED angle", () => {
    // Fixed, not a blend: a blend's effect depends on how far off the push
    // already was, so shoving at 90° would move you further than shoving at
    // 10° and the control would feel different every time you used it.
    const p = state.player!;
    expect(nudgeTable(0, 1)).toBe(true);

    const turned = Math.atan2(p.momZ, p.momX); // was 0
    expect(Math.abs(turned)).toBeCloseTo(NUDGE_BEND, 5);
    expect(Math.hypot(p.momX, p.momZ)).toBeCloseTo(1, 6); // still a unit heading
  });

  it("turns TOWARD the push, on either side", () => {
    // The assertion that cannot pass by accident. A sign error in the rotation
    // still produces a fixed-size turn of the right magnitude on the right axis
    // — it just goes the wrong way, which reads as broken controls rather than
    // as a wrong number. So: measure the angle to the push BEFORE and AFTER,
    // and require it to have shrunk. Both sides, because a sign error that
    // happens to be symmetric would survive testing only one.
    for (const [dx, dz] of [
      [0, 1],
      [0, -1],
    ]) {
      resetTilt();
      riding();
      const p = state.player!;
      const before = Math.acos(Math.max(-1, Math.min(1, p.momX * dx + p.momZ * dz)));

      expect(nudgeTable(dx, dz)).toBe(true);

      const after = Math.acos(Math.max(-1, Math.min(1, p.momX * dx + p.momZ * dz)));
      expect(after).toBeLessThan(before);
      expect(before - after).toBeCloseTo(NUDGE_BEND, 5);
    }
  });

  it("adds a little pace as well as direction", () => {
    nudgeTable(0, 1);
    expect(state.player!.momSpeed).toBeCloseTo(10 + NUDGE_SPEED_ADD, 5);
  });

  it("does nothing with no momentum to bend", () => {
    state.player!.momSpeed = 0;
    expect(nudgeTable(0, 1)).toBe(false);
    expect(tiltLevel()).toBe(0); // and costs nothing, so a walker cannot tilt
  });

  it("does nothing with no direction pushed", () => {
    expect(nudgeTable(0, 0)).toBe(false);
  });

  it("one HELD Shift is one nudge, not sixty a second", () => {
    // THE RE-SHOVE GUARD. Without it a held modifier lands a shove every frame,
    // which is both an infinitely strong steer and an instant tilt.
    expect(nudgeTable(0, 1)).toBe(true);
    for (let k = 0; k < 10; k++) expect(nudgeTable(0, 1)).toBe(false);

    updateTilt(NUDGE_COOLDOWN);
    expect(nudgeTable(0, 1)).toBe(true);
  });
});

describe("the meter", () => {
  it("charges per shove and drains with time", () => {
    nudgeTable(0, 1);
    expect(tiltLevel()).toBeCloseTo(TILT_PER_NUDGE, 5);

    updateTilt(TILT_PER_NUDGE / TILT_DECAY);
    expect(tiltLevel()).toBeCloseTo(0, 5);
  });

  it("tilts on the third shove inside the window", () => {
    const landed = shove(3);
    expect(landed).toBe(3);
    expect(tiltLevel()).toBe(1);
    expect(tiltLockRemaining()).toBeCloseTo(TILT_LOCKOUT, 5);
  });

  it("does NOT tilt when the shoves are spaced out", () => {
    // The whole point of a decaying meter: three nudges is only a tilt if they
    // are three nudges in a hurry. A hard cap would make the mechanic a budget
    // instead of a rhythm.
    for (let k = 0; k < 5; k++) {
      expect(nudgeTable(0, 1)).toBe(true);
      updateTilt(2.0); // plenty of time to settle
    }
    expect(tiltLevel()).toBeCloseTo(0, 5);
    expect(tiltLockRemaining()).toBe(0);
  });
});

describe("the penalty", () => {
  it("a tilt kills the ride and takes the chain with it", () => {
    const p = state.player!;
    p.bounceCombo = 7;
    p.bounceComboT = 1.5;
    state.partComboHits = 4;
    state.shotChain = ["ramp", "orbit"];

    shove(3);

    expect(p.momSpeed).toBe(0);
    expect(p.bounceCombo).toBe(0);
    expect(p.bounceComboT).toBe(0);
    expect(state.partComboHits).toBe(0);
    expect(state.shotChain).toEqual([]);
  });

  it("the meter is FROZEN full through the lockout, not draining under it", () => {
    // If it drained during the lockout, the punishment would end early and the
    // player would be back to one shove from a tilt the moment it lifted.
    shove(3);
    updateTilt(TILT_LOCKOUT / 2);
    expect(tiltLevel()).toBe(1);

    updateTilt(TILT_LOCKOUT / 2);
    expect(tiltLockRemaining()).toBe(0);
  });

  it("refuses every shove while locked out", () => {
    shove(3);
    riding(); // a fresh ride — the lockout is on the TABLE, not the knight
    expect(nudgeTable(0, 1)).toBe(false);

    updateTilt(TILT_LOCKOUT);
    expect(nudgeTable(0, 1)).toBe(true);
  });
});

describe("floor scope", () => {
  it("resetTilt clears the meter, the lockout and the warning", () => {
    // Carrying a tilt meter down the stairs would mean a floor you have not
    // touched is already one shove from a penalty.
    shove(3);
    expect(tiltLevel()).toBe(1);

    resetTilt();
    riding(); // the tilt killed the ride; a new floor starts you moving again

    expect(tiltLevel()).toBe(0);
    expect(tiltLockRemaining()).toBe(0);
    expect(nudgeTable(0, 1)).toBe(true);
  });
});
