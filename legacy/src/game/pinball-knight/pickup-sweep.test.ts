import { describe, it, expect, beforeEach } from "vitest";
import { checkPickups, resetPickupSweep, segmentDistance } from "./economy/pickups";
import { state } from "./state";
import type { GroundItem } from "./state";
import { CARD_IDS } from "./cards";
import { CARD_PICKUP_RANGE, FIXED_STEP, PICKUP_SWEEP_MAX, PINBALL_MAX_SPEED } from "./constants";

/**
 * THE BUG THIS FILE EXISTS FOR
 *
 * Pickups were a point-in-radius test, run once per fixed step, against the
 * position the step ENDED at. Fine at walking pace and quietly wrong at pinball
 * pace: a 60Hz step at PINBALL_MAX_SPEED covers 0.37 units, so a card a little
 * off the ball's line has BOTH samples land outside its radius and is never
 * picked up — no matter how squarely you ran over it. Reported as "I can't pick
 * up the cards when I run over them", and it got worse the better you played.
 *
 * The fix tests the SEGMENT the knight travelled, not the point it stopped on.
 */

/** A ground item with a sprite stub — no WebGL, same disposal contract. */
function fakeItem(kind: GroundItem["kind"], id: string, x: number, z: number): GroundItem {
  return {
    kind,
    id,
    x,
    z,
    bobPhase: 0,
    sprite: { mesh: {}, dispose: () => {} } as unknown as GroundItem["sprite"],
  };
}

function stubWorld(): void {
  state.player = { x: 0, z: 0, magnetAuraT: 0 } as unknown as typeof state.player;
  state.groundItems = [];
  state.scene = null;
  state.vfx = null;
  state.container = null;
  state.cardStash = [];
  state.floorHaul = [];
  state.seenCards = new Set();
  // Both hands empty, so a card can only go to the stash — one place to assert.
  state.weaponSlots = [null, null];
  state.activeSlot = 0;
  resetPickupSweep();
}

/** Move the knight to (x,z) and run one 60Hz pickup step. */
function step(x: number, z: number): void {
  state.player!.x = x;
  state.player!.z = z;
  checkPickups(FIXED_STEP);
}

describe("segmentDistance", () => {
  it("measures to the nearest point ON the segment, not to its ends", () => {
    // Perpendicular offset from the middle of a long segment.
    expect(segmentDistance(-5, 0, 5, 0, 0, 3)).toBeCloseTo(3, 6);
    // Past an end: clamps to the endpoint rather than extending the line.
    expect(segmentDistance(-5, 0, 5, 0, 9, 0)).toBeCloseTo(4, 6);
    expect(segmentDistance(-5, 0, 5, 0, -9, 0)).toBeCloseTo(4, 6);
  });

  it("degrades to point distance when the knight stood still", () => {
    expect(segmentDistance(2, 2, 2, 2, 2, 5)).toBeCloseTo(3, 6);
  });
});

describe("running over a card at pinball speed", () => {
  beforeEach(stubWorld);

  // The step length and lateral offset here are the real numbers: 22 u/s at
  // 60Hz, and a card just inside the grab radius. The pass is deliberately
  // PHASED so no sample lands at the closest approach — which is the common
  // case, not a contrived one, since the sample grid has nothing to do with
  // where the card happens to lie.
  const stepLen = PINBALL_MAX_SPEED * FIXED_STEP;
  const offset = CARD_PICKUP_RANGE - 0.02;
  const xs: number[] = [];
  for (let i = -6; i <= 6; i++) xs.push(i * stepLen + stepLen / 2);

  it("picks the card up (the point test at the same samples would miss it)", () => {
    const card = fakeItem("card", CARD_IDS[0], 0, offset);
    state.groundItems = [card];

    // First, pin the premise: at these samples EVERY point distance is outside
    // the grab radius, so the old code could not have taken this card. If that
    // stops being true the assertion below stops testing anything, so it is
    // checked rather than assumed.
    for (const x of xs) {
      expect(Math.hypot(x - card.x, offset)).toBeGreaterThan(CARD_PICKUP_RANGE);
    }

    for (const x of xs) step(x, 0);
    expect(state.groundItems).toHaveLength(0);
    expect(state.cardStash).toEqual([CARD_IDS[0]]);
  });

  it("still ignores a card the knight genuinely passed wide of", () => {
    state.groundItems = [fakeItem("card", CARD_IDS[0], 0, CARD_PICKUP_RANGE + 0.35)];
    for (const x of xs) step(x, 0);
    expect(state.groundItems).toHaveLength(1);
    expect(state.cardStash).toEqual([]);
  });

  it("works the same at a slow walk — the sweep is not a speed-only path", () => {
    state.groundItems = [fakeItem("card", CARD_IDS[0], 0, 0.2)];
    for (let i = -20; i <= 20; i++) step(i * 0.05, 0);
    expect(state.cardStash).toEqual([CARD_IDS[0]]);
  });
});

describe("the sweep never draws a line through a teleport", () => {
  beforeEach(stubWorld);

  it("leaves items lying on the line between two far-apart samples", () => {
    // Pit respawn / floor start / portal: the knight did not TRAVEL this path.
    const mid = PICKUP_SWEEP_MAX * 4;
    state.groundItems = [fakeItem("card", CARD_IDS[0], mid, 0)];
    step(0, 0);
    step(mid * 2, 0);
    expect(state.groundItems).toHaveLength(1);
    expect(state.cardStash).toEqual([]);
  });

  // A short hop is INSIDE PICKUP_SWEEP_MAX, so the cap alone cannot catch a new
  // floor whose spawn lands near the old floor's last sample — only the
  // explicit reset can. `cardX` sits on the line between the two samples but
  // 0.9 from where the knight actually is, i.e. outside CARD_PICKUP_RANGE.
  const oldPos = 0;
  const newPos = 1.2;
  const cardX = 0.3;

  it("forgets the previous position across a floor change", () => {
    step(oldPos, 0); // the old floor's last sample
    resetPickupSweep(); // startLevel does this before the new spawn
    state.groundItems = [fakeItem("card", CARD_IDS[0], cardX, 0)];
    step(newPos, 0);
    expect(state.groundItems).toHaveLength(1);
    expect(state.cardStash).toEqual([]);
  });

  it("…and the reset is what does it — without it the same hop grabs the card", () => {
    // The negative control. Without this the test above would pass even if
    // resetPickupSweep were a no-op and the distance cap were doing the work.
    step(oldPos, 0);
    state.groundItems = [fakeItem("card", CARD_IDS[0], cardX, 0)];
    step(newPos, 0);
    expect(state.cardStash).toEqual([CARD_IDS[0]]);
  });
});

describe("grab radius by kind", () => {
  beforeEach(stubWorld);

  it("gives cards a wider mouth than a spare helmet", () => {
    const off = CARD_PICKUP_RANGE - 0.05; // inside a card's reach, outside gear's
    state.groundItems = [fakeItem("card", CARD_IDS[0], 0, off), fakeItem("gear", "helm", 3, off)];
    step(0, 0);
    step(3, 0);
    expect(state.groundItems.map((i) => i.kind)).toEqual(["gear"]);
  });
});
