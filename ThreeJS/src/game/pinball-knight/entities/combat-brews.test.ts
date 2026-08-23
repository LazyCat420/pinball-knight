/**
 * Runtime wiring for the two craft-brew effects that ride EVERY hit through the
 * shared on-hit choke point (applyCardOnHit): Venom Coat (your strikes poison)
 * and Static Charge (the blow arcs to a nearby foe). Rendering/audio are not
 * tested (house rule) — state.vfx is left undefined so the optional-chained VFX
 * no-op, and sprites are stubbed just enough for setTint().
 */
import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { applyCardOnHit } from "./combat";
import { STATIC_ARC_DAMAGE } from "../items";
import { CARD_BURN_TIME } from "../constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZombie = any;

function fakeZombie(x: number, z: number, over: Record<string, unknown> = {}): AnyZombie {
  return {
    kind: "zombie",
    hp: 10,
    mode: "chase",
    x,
    z,
    dotT: 0,
    dotDmg: 0,
    dotTickT: 0,
    chillT: 0,
    flashT: 0,
    aggro: false,
    sprite: { setTint() {} },
    ...over,
  };
}

beforeEach(() => {
  // A bare-handed knight (no weapon, no cards) so the card branch is skipped and
  // ONLY the brew effects can fire. VFX + grid left undefined; grid is only read
  // by the static arc's damageZombie, which needs it merely truthy.
  state.player = { x: 0, z: 0, ...freshPlayerFields() } as AnyZombie;
  state.weaponSlots = [null, null];
  state.activeSlot = 0;
  state.zombies = [];
  state.vfx = undefined as never;
  state.grid = {} as never; // truthy so damageZombie doesn't early-return
});

describe("Venom Coat (applyCardOnHit)", () => {
  it("stamps the poison DoT on the struck enemy while active", () => {
    const p = state.player!;
    p.venomCoatT = 5;
    const z = fakeZombie(1, 0);
    applyCardOnHit(z);
    expect(z.dotT).toBe(CARD_BURN_TIME);
    expect(z.dotDmg).toBeGreaterThan(0);
  });

  it("does nothing to the enemy when the buff is off", () => {
    const z = fakeZombie(1, 0);
    applyCardOnHit(z); // venomCoatT is 0
    expect(z.dotT).toBe(0);
  });
});

describe("Static Charge (applyCardOnHit)", () => {
  it("arcs to the NEAREST other living foe within range", () => {
    const p = state.player!;
    p.staticT = 5;
    const hit = fakeZombie(0, 0); // the one you struck
    const near = fakeZombie(1.5, 0); // in range
    const far = fakeZombie(50, 0); // out of range
    state.zombies = [hit, near, far];
    applyCardOnHit(hit);
    expect(near.hp).toBe(10 - STATIC_ARC_DAMAGE); // took the arc
    expect(far.hp).toBe(10); // untouched
    expect(hit.hp).toBe(10); // never arcs back to the source
  });

  it("does not arc when the buff is off", () => {
    const hit = fakeZombie(0, 0);
    const near = fakeZombie(1.5, 0);
    state.zombies = [hit, near];
    applyCardOnHit(hit); // staticT is 0
    expect(near.hp).toBe(10);
  });

  it("no-ops safely when there is no other foe to arc to", () => {
    const p = state.player!;
    p.staticT = 5;
    const hit = fakeZombie(0, 0);
    state.zombies = [hit];
    expect(() => applyCardOnHit(hit)).not.toThrow();
  });
});
