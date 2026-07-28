/**
 * Oil-pool behavior (Slick Field): the floor-fx overlap loop greases enemies,
 * feeds the rolling ball's oilT glide, and any overlapping FIRE ignites the
 * whole pool. Rendering is exercised only through THREE's headless scene-graph
 * objects (real meshes, stubbed scene); VFX/audio stay undefined per house rule.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnFloorFx, updateFloorFx, clearFloorFx } from "./floor-fx";
import { state } from "../state";
import {
  OIL_ZOMBIE_T,
  OIL_MARBLE_T,
  OIL_IGNITE_LIFE,
  OIL_SLICK_RADIUS,
  OIL_SLICK_LIFE,
  CARD_CHILL_TIME,
  FROST_RUNE_RADIUS,
  FROST_RUNE_LIFE,
  TAR_PIT_RADIUS,
  TAR_PIT_LIFE,
  LIGHTNING_ROD_RADIUS,
  LIGHTNING_ROD_LIFE,
  LIGHTNING_ROD_DAMAGE,
  FLOOR_FX_MAX,
} from "../constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeZombie(x: number, z: number): any {
  return { kind: "zombie", hp: 10, mode: "chase", x, z, burnT: 99, oiledT: 0 };
}

beforeEach(() => {
  clearFloorFx();
  state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
  state.vfx = undefined as never;
  state.grid = null;
  state.zombies = [];
  state.dbgMaterialFloorFx = true;
  state.dbgMaterialSelfHarm = false;
  state.player = { x: 50, z: 50, momSpeed: 0, oilT: 0, hp: 3, iframes: 0 } as unknown as typeof state.player;
});

describe("oil pool overlap", () => {
  it("greases enemies standing in it and tops up the rolling ball's oilT", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    const inPool = fakeZombie(0.5, 0);
    const outside = fakeZombie(9, 9);
    state.zombies = [inPool, outside];
    const p = state.player!;
    p.x = 0;
    p.z = 0.5;
    p.momSpeed = 8; // rolling
    updateFloorFx(0.016);
    expect(inPool.oiledT).toBe(OIL_ZOMBIE_T);
    expect(outside.oiledT).toBe(0);
    expect(p.oilT).toBe(OIL_MARBLE_T);
  });

  it("does not grease the ball while walking (momSpeed 0)", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    const p = state.player!;
    p.x = 0;
    p.z = 0;
    p.momSpeed = 0;
    updateFloorFx(0.016);
    expect(p.oilT).toBe(0);
  });
});

describe("oil ignition", () => {
  it("converts the whole pool to a long fire when any fire fx overlaps it", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    spawnFloorFx("fire", 1.2, 0, 0.55, 3.5); // a flipper-trail scar clipping the pool
    updateFloorFx(0.016);
    const oils = state.floorFx.filter((f) => f.kind === "oil");
    const fires = state.floorFx.filter((f) => f.kind === "fire");
    expect(oils).toHaveLength(0);
    // The original scar plus the ignited pool, burning at the pool's footprint.
    expect(fires).toHaveLength(2);
    const ignited = fires.find((f) => f.radius === OIL_SLICK_RADIUS);
    expect(ignited).toBeDefined();
    expect(ignited!.maxLife).toBe(OIL_IGNITE_LIFE);
  });

  it("leaves a fire-free pool alone", () => {
    spawnFloorFx("oil", 0, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
    spawnFloorFx("fire", 9, 9, 0.55, 3.5); // far away
    updateFloorFx(0.016);
    expect(state.floorFx.filter((f) => f.kind === "oil")).toHaveLength(1);
  });
});

/**
 * THE DEFERRED THREE, cashed in (ABILITY_FX_PLAN "deliberately deferred").
 *
 * Frost Runes, Tar Pit and Lightning Rod were predicted to be new FloorFxKinds
 * rather than new subsystems, and they are. Each test below asks the only
 * question that matters for a floor scar: does standing on it CHANGE anything.
 */
describe("frost runes", () => {
  it("chills the horde standing on them and skates the rolling ball", () => {
    spawnFloorFx("frost", 0, 0, FROST_RUNE_RADIUS, FROST_RUNE_LIFE);
    const on = fakeZombie(0.3, 0);
    const off = fakeZombie(9, 9);
    on.chillT = 0;
    off.chillT = 0;
    state.zombies = [on, off];
    const p = state.player!;
    p.x = 0;
    p.z = 0.3;
    p.momSpeed = 9;
    updateFloorFx(0.016);
    expect(on.chillT).toBe(CARD_CHILL_TIME);
    expect(off.chillT).toBe(0);
    // Ice is a rink for the ball, not a brake: same channel oil uses.
    expect(p.oilT).toBe(OIL_MARBLE_T);
  });
});

describe("tar pit", () => {
  it("is oil's inverse — it chills, CANCELS a skid, and eats the ball's speed", () => {
    spawnFloorFx("tar", 0, 0, TAR_PIT_RADIUS, TAR_PIT_LIFE);
    const stuck = fakeZombie(0.4, 0);
    stuck.chillT = 0;
    stuck.slipT = 2; // mid-skid when it hits the pit
    state.zombies = [stuck];
    const p = state.player!;
    p.x = 0;
    p.z = 0.4;
    p.momSpeed = 12;
    updateFloorFx(0.1);
    expect(stuck.chillT).toBe(CARD_CHILL_TIME);
    expect(stuck.slipT).toBe(0); // bodies COLLECT in tar, they don't slide through
    // …and the drag is not a courtesy applied only to the horde.
    expect(p.momSpeed).toBeLessThan(12);
    expect(p.momSpeed).toBeGreaterThan(0);
  });

  it("leaves a ball outside its footprint alone", () => {
    spawnFloorFx("tar", 0, 0, TAR_PIT_RADIUS, TAR_PIT_LIFE);
    const p = state.player!;
    p.x = 9;
    p.z = 9;
    p.momSpeed = 12;
    updateFloorFx(0.1);
    expect(p.momSpeed).toBe(12);
  });
});

describe("lightning rod", () => {
  it("arcs at the NEAREST live foe in range, and at nothing out of it", () => {
    state.grid = {} as never; // truthy so damageZombie doesn't early-return
    spawnFloorFx("rod", 0, 0, LIGHTNING_ROD_RADIUS, LIGHTNING_ROD_LIFE);
    const near = { ...fakeZombie(1, 0), kind: "ghost", vulnT: 5, hp: 40, flashT: 0, aggro: false, sprite: { setTint() {}, mesh: { position: { set() {} } } } };
    const far = { ...fakeZombie(2.5, 0), kind: "ghost", vulnT: 5, hp: 40, flashT: 0, aggro: false, sprite: { setTint() {}, mesh: { position: { set() {} } } } };
    const outOfRange = { ...fakeZombie(30, 0), kind: "ghost", vulnT: 5, hp: 40, flashT: 0, aggro: false, sprite: { setTint() {}, mesh: { position: { set() {} } } } };
    state.zombies = [far, near, outOfRange]; // deliberately not in distance order
    updateFloorFx(0.016); // tick starts at 0 → fires on the first frame
    expect(near.hp).toBe(40 - LIGHTNING_ROD_DAMAGE);
    expect(far.hp).toBe(40); // one target per tick, and it is the closest one
    expect(outOfRange.hp).toBe(40);
  });

  it("is silent in an empty room instead of throwing", () => {
    state.grid = {} as never;
    spawnFloorFx("rod", 0, 0, LIGHTNING_ROD_RADIUS, LIGHTNING_ROD_LIFE);
    state.zombies = [];
    expect(() => updateFloorFx(0.5)).not.toThrow();
  });
});

/**
 * THE CAP, under the combo the plan itself calls out.
 *
 * Slick Field into Flipper Charge is the built-in synergy: a spill, a burning
 * ride across it, and an ignition that despawns the pool and spawns a fire in
 * its place. That is a spawn INSIDE the update loop, which is exactly the shape
 * that can outrun an eviction policy — so the budget is asserted against a spam
 * run rather than against a comment.
 */
describe("FLOOR_FX_MAX holds under a Slick-Field → Flipper-Charge spam run", () => {
  it("never exceeds the budget, even mid-frame, across hundreds of stamps", () => {
    const p = state.player!;
    p.momSpeed = 14;
    for (let i = 0; i < 900; i++) {
      // A slick every few tiles, a burning trail scar every tile — the ride.
      if (i % 4 === 0) spawnFloorFx("oil", i * 0.7, 0, OIL_SLICK_RADIUS, OIL_SLICK_LIFE);
      spawnFloorFx("fire", i * 0.7, 0, 0.55, 3.5);
      if (i % 9 === 0) spawnFloorFx("tar", i * 0.7, 0, TAR_PIT_RADIUS, TAR_PIT_LIFE);
      expect(state.floorFx.length).toBeLessThanOrEqual(FLOOR_FX_MAX);
      // Ignition runs inside updateFloorFx and both despawns and spawns.
      p.x = i * 0.7;
      updateFloorFx(0.016);
      expect(state.floorFx.length).toBeLessThanOrEqual(FLOOR_FX_MAX);
    }
  }, 20000);
});
