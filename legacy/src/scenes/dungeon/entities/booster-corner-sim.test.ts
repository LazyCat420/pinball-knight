/**
 * BOOSTER CORNER-CLIP — an end-to-end simulation, not a handler unit test.
 *
 * The reported bug: "on the sharp corners with the booster it will just keep
 * clipping and cause the player to just bounce back and forth between the corner
 * and the booster." pinball-collide.test.ts pins the HANDLER's contract; this
 * pins the SYSTEM's, by running the real collider (collision.moveCircle) against
 * real corner geometry under the real momentum physics, and asking the only
 * question that matters: does the ride ever end?
 *
 * Measured on this harness before the jam guard: 327 booster firings across 60
 * simulated seconds and the ride NEVER ended, with the knight confined to a
 * 1.2-unit box. After: 3 firings, ride over in 0.77s.
 *
 * WHY the pocket-rattle damp in player.ts can't break it on its own — visible in
 * the trace: the damp scrubs momSpeed (14.05 → 8.19) and the very next booster
 * contact restores it with `Math.max(momSpeed, BOOSTER_SPEED)` (→ 14.99). The
 * two fight every cycle and the booster always wins, so the loop is STABLE
 * rather than decaying. The escape condition is therefore not "slower" but "the
 * pad stops re-aiming me", which is what the jam guard provides.
 *
 * NOTE for anyone extending this: the loop below must keep mirroring
 * updatePinball's real order (collide → reflect+restitution → parts → friction →
 * exit). An earlier draft of this file omitted restitution and friction, which
 * models a LOSSLESS world where any enclosed ball oscillates forever — it
 * "passed" identically before and after the fix and proved nothing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields, type PinballPart } from "../state";
import { touchPinballParts, type PinballDeps } from "./pinball-collide";
import { moveCircle } from "../collision";
// T_WALL = 0 and T_FLOOR = 1 — the opposite of the "0 is empty" instinct, so
// these are imported, never hand-rolled: inverting them yields an all-floor grid
// where the ball simply flies away and the trap never forms.
import { T_WALL, T_FLOOR, isWalkable, type Grid } from "../maze/generator";
import {
  PLAYER_R,
  PLAYER_SPEED,
  PINBALL_WALL_RESTITUTION,
  PINBALL_FRICTION,
  PINBALL_EXIT_MULT,
  FRICTION_OPEN,
  FRICTION_CORRIDOR,
  FRICTION_TIGHT,
  POCKET_RADIUS,
  POCKET_BOUNCES,
  POCKET_DAMP,
  POCKET_WINDOW,
} from "../constants";

/**
 * A SHARP CORNER — a 2×3 pocket. The booster sits at tile (2,2) firing EAST
 * (+x) directly into the wall on its right, the geometry the report describes.
 * Open floor lies north and south, so an un-trapped ball has somewhere to go:
 * if the knight never leaves, that is the bug and not a sealed room.
 *
 *      # # # # #
 *      # . . # #
 *      # . B # #     B = booster, firing east into the wall at its right
 *      # . . # #
 *      # # # # #
 */
function cornerGrid(): Grid {
  const w = 5;
  const h = 5;
  const t = new Uint8Array(w * h).fill(T_WALL);
  const open: Array<[number, number]> = [
    [1, 1], [2, 1],
    [1, 2], [2, 2],
    [1, 3], [2, 3],
  ];
  for (const [i, j] of open) t[j * w + i] = T_FLOOR;
  return { w, h, t, shapes: new Uint8Array(w * h) };
}

/** A booster on tile (i,j) of `g`, aimed along (dirX,dirZ). */
function boosterAt(g: Grid, i: number, j: number, dirX: number, dirZ: number): PinballPart {
  return {
    kind: "booster",
    i,
    j,
    x: i + 0.5 - g.w / 2,
    z: j + 0.5 - g.h / 2,
    dirX,
    dirZ,
    dir2X: 0,
    dir2Z: 0,
    cooldownT: 0,
    hitT: -1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mesh: undefined as any,
  };
}

let deps: PinballDeps;
/** Live steer-lock timer, written by the deps below — the "dead stick" measure. */
let steerLockT = 0;

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as any;
  state.pinballParts = [];
  state.vfx = null;
  state.partComboHits = 0;
  state.frenzyPaid = false;
  state.goldRun = 0;
  state.zombies = [];
  steerLockT = 0;
  deps = {
    startRampHop: () => {},
    startDrop: () => {},
    setSteerLock: (t) => {
      steerLockT = t;
    },
    raiseSteerLock: (t) => {
      steerLockT = Math.max(steerLockT, t);
    },
  };
});

/**
 * Run the momentum ride, mirroring updatePinball's real order of operations.
 * Returns how many times a booster fired and the frame the ride ended on
 * (-1 = still going, i.e. the knight never got control back).
 */
function ride(g: Grid, frames: number): { fires: number; endedAt: number; maxD: number; lockedFrames: number } {
  const p = state.player!;
  const dt = 1 / 60;
  const originX = p.x;
  const originZ = p.z;
  let pocketAX = 0;
  let pocketAZ = 0;
  let pocketN = 0;
  let pocketT = 0;
  let fires = 0;
  let maxD = 0;
  let lockedFrames = 0;
  // The pocket-rattle guard, as player.ts applies it.
  const notePocketBounce = (): void => {
    if (pocketT > 0 && Math.hypot(p.x - pocketAX, p.z - pocketAZ) < POCKET_RADIUS) {
      pocketN++;
      if (pocketN > POCKET_BOUNCES) p.momSpeed *= POCKET_DAMP;
    } else {
      pocketAX = p.x;
      pocketAZ = p.z;
      pocketN = 1;
    }
    pocketT = POCKET_WINDOW;
  };

  for (let f = 0; f < frames; f++) {
    // Part timers are ticked by the renderer in the real loop (one owner).
    for (const part of state.pinballParts) {
      part.cooldownT = Math.max(0, part.cooldownT - dt);
      if (part.jamT !== undefined && part.jamT > 0) {
        part.jamT = Math.max(0, part.jamT - dt);
        if (part.jamT === 0) part.jamN = 0;
      }
    }
    pocketT = Math.max(0, pocketT - dt);
    steerLockT = Math.max(0, steerLockT - dt);
    if (steerLockT > 0) lockedFrames++;

    const step = p.momSpeed * dt;
    const tx = p.x + p.momX * step;
    const tz = p.z + p.momZ * step;
    const res = moveCircle(g, p.x, p.z, PLAYER_R, p.momX * step, p.momZ * step);
    const blockedX = Math.abs(res.x - tx) > 1e-6;
    const blockedZ = Math.abs(res.z - tz) > 1e-6;
    p.x = res.x;
    p.z = res.z;
    if (blockedX || blockedZ) {
      if (blockedX) p.momX = -p.momX;
      if (blockedZ) p.momZ = -p.momZ;
      p.momSpeed *= PINBALL_WALL_RESTITUTION;
      notePocketBounce();
    }

    const before = p.momSpeed;
    touchPinballParts(true, 0, deps);
    if (p.momSpeed > before + 1e-9) {
      fires++;
      notePocketBounce();
    }

    // Per-surface friction, then the ride's exit test.
    const ti = Math.floor(p.x + g.w / 2);
    const tj = Math.floor(p.z + g.h / 2);
    let openN = 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (isWalkable(g, ti + di, tj + dj)) openN++;
    }
    const surf = openN >= 3 ? FRICTION_OPEN : openN === 2 ? FRICTION_CORRIDOR : FRICTION_TIGHT;
    p.momSpeed = Math.max(0, p.momSpeed - PINBALL_FRICTION * surf * dt);
    maxD = Math.max(maxD, Math.hypot(p.x - originX, p.z - originZ));
    if (p.momSpeed < PLAYER_SPEED * PINBALL_EXIT_MULT) return { fires, endedAt: f, maxD, lockedFrames };
  }
  return { fires, endedAt: -1, maxD, lockedFrames };
}

describe("booster fired into a sharp corner", () => {
  beforeEach(() => {
    const g = cornerGrid();
    const pad = boosterAt(g, 2, 2, 1, 0); // aimed EAST, into the wall
    state.pinballParts = [pad];
    const p = state.player!;
    p.x = pad.x;
    p.z = pad.z;
    p.momX = 1;
    p.momZ = 0;
    p.momSpeed = 0;
  });

  it("the ride ENDS — the knight gets control back instead of rattling forever", () => {
    // 60 simulated seconds. Before the guard this returned endedAt = -1: the
    // booster re-floored the speed faster than friction and the pocket damp
    // could bleed it, so the ride literally never terminated.
    const { endedAt } = ride(cornerGrid(), 3600);

    expect(endedAt).toBeGreaterThan(-1);
    expect(endedAt).toBeLessThan(300); // and promptly — within ~5s, not by luck
  });

  it("the trapped pad stops re-launching (327 firings before the guard)", () => {
    const { fires } = ride(cornerGrid(), 3600);

    expect(fires).toBeLessThan(10);
  });

  /**
   * The FEEL regression, reported after the first fix shipped: "the clipping is
   * a lot less but I still notice a stutter... like a friction feeling between
   * the booster and that corner."
   *
   * Ending the ride was never the thing the player perceives — CONTROL is. Every
   * booster re-fire re-arms BOOSTER_STEER_LOCK, so while the pad keeps catching
   * you the stick does nothing, and that is what reads as friction. The guard
   * has to hand steering back FAST, not merely terminate eventually.
   */
  it("hands steering back quickly — the stutter is measured in steer-lock, not speed", () => {
    const g = cornerGrid();
    const pad = boosterAt(g, 2, 2, 1, 0);
    state.pinballParts = [pad];
    const p = state.player!;
    p.x = pad.x;
    p.z = pad.z;
    p.momX = 1;
    p.momZ = 0;
    p.momSpeed = 0;

    const { lockedFrames } = ride(g, 3600);

    // At BOOSTER_JAM_HITS = 3 this was ~37 frames (0.62s) of dead stick; at 1 it
    // is ~14 (0.23s). Anything approaching half a second reads as the pad
    // fighting the player.
    expect(lockedFrames).toBeLessThan(20);
  });
});

describe("a legitimate booster lane still works", () => {
  /**
   * The regression risk of the jam guard: a real booster CHAIN must not read as
   * a jam. This is a clear 8-tile corridor with three pads down it, all aimed
   * east — the knight should be carried the length of the lane, not stood down.
   */
  function laneGrid(): Grid {
    const w = 12;
    const h = 3;
    const t = new Uint8Array(w * h).fill(T_WALL);
    for (let i = 1; i < w - 1; i++) t[1 * w + i] = T_FLOOR;
    return { w, h, t, shapes: new Uint8Array(w * h) };
  }

  it("carries the knight down the lane, firing every pad", () => {
    const g = laneGrid();
    const pads = [boosterAt(g, 2, 1, 1, 0), boosterAt(g, 5, 1, 1, 0), boosterAt(g, 8, 1, 1, 0)];
    state.pinballParts = pads;
    const p = state.player!;
    p.x = pads[0].x;
    p.z = pads[0].z;
    p.momX = 1;
    p.momZ = 0;
    p.momSpeed = 0;

    const { fires, maxD } = ride(g, 120);

    expect(fires).toBeGreaterThanOrEqual(3); // every pad in the chain fired
    expect(maxD).toBeGreaterThan(5); // and actually carried him down the lane
  });
});
