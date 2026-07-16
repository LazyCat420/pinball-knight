/**
 * The floating sheet-ghost: the one enemy that ignores the maze. These tests pin
 * the *contract* that makes it distinct — it's a straight-line wall-phaser — via
 * its tuning constants and a pure re-implementation of its drift step (the real
 * updateGhost pulls in DOM/three, so we test the movement MATH here, mirroring
 * the house rule used for the roll/pinball math).
 */
import { describe, it, expect } from "vitest";
import {
  GHOST_HP,
  GHOST_SPEED_FACTOR,
  GHOST_FROM_LEVEL,
  GHOST_RATIO,
  GHOST_HOVER_Y,
  GHOST_BOB_AMP,
  ZOMBIE_HP,
} from "../constants";

describe("ghost tuning", () => {
  it("is fragile and slow — a positioning threat, not a bruiser", () => {
    expect(GHOST_HP).toBeLessThanOrEqual(ZOMBIE_HP); // dies fast
    expect(GHOST_SPEED_FACTOR).toBeLessThan(1); // slower than a zombie's base
    expect(GHOST_SPEED_FACTOR).toBeGreaterThan(0);
  });

  it("haunts early and isn't rare (you meet it soon)", () => {
    expect(GHOST_FROM_LEVEL).toBeGreaterThanOrEqual(1);
    expect(GHOST_RATIO).toBeGreaterThan(1); // a slice of the horde, not all of it
  });

  it("hovers off the floor with a bob that never dips below the ground", () => {
    // The hover height must clear the bob amplitude, or the low point of the
    // sine bob would sink the ghost into the floor.
    expect(GHOST_HOVER_Y).toBeGreaterThan(GHOST_BOB_AMP);
  });
});

describe("ghost drift math (straight line through walls)", () => {
  // Mirror updateGhost's integration: move straight toward the target at `speed`
  // WITHOUT any collision clamp — the defining "phases through walls" behaviour.
  function driftStep(x: number, z: number, tx: number, tz: number, speed: number, dt: number): { x: number; z: number } {
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: x + (dx / d) * speed * dt, z: z + (dz / d) * speed * dt };
  }

  it("closes the straight-line distance to the player every step", () => {
    // Player at the origin; ghost starts far on a diagonal. Each step must reduce
    // the distance monotonically and eventually arrive — regardless of any walls
    // in between (there is no collision in the model, by design).
    let x = 8;
    let z = 6;
    const speed = 2;
    const dt = 1 / 60;
    let prev = Math.hypot(x, z);
    for (let i = 0; i < 600; i++) {
      const n = driftStep(x, z, 0, 0, speed, dt);
      x = n.x;
      z = n.z;
      const d = Math.hypot(x, z);
      expect(d).toBeLessThanOrEqual(prev + 1e-9); // never retreats
      prev = d;
      if (d < 0.1) break;
    }
    expect(prev).toBeLessThan(0.2); // arrived at the player
  });
});
