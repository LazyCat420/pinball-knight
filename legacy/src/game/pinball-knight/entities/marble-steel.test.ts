/**
 * STEEL — the BARE ball form's own physics.
 *
 * Ball form always looked like a physics object but handled like the knight
 * with momentum bolted on: same masonry threshold as a bare roll, same shove,
 * no extra mass anywhere. Steel gives the no-material ball real weight.
 *
 * The invariant these tests exist to protect: steel is the baseline for NO
 * material only. A pickup replaces the ball's substance, so diamond/storm/
 * shadow/lava must keep their own neutral values rather than inheriting
 * steel's weight on top of their identity (a first pass got this wrong and
 * marble-storm.test.ts caught it).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { state, type MarbleMaterial } from "../state";
import {
  materialBreakSpeeds,
  materialFrictionMult,
  materialSteerMult,
  materialRamKnockback,
  materialRamDamageMult,
  materialWallBreakCost,
  MATERIAL_LIST,
} from "./marble";
import {
  WALL_BREAK_SPEED,
  SECRET_BREAK_SPEED,
  WALL_BREAK_SPEED_COST,
  BALL_RAM_KNOCKBACK,
  STEEL_WALL_BREAK_SPEED,
  STEEL_SECRET_BREAK_SPEED,
  STEEL_RAM_KNOCKBACK,
  STEEL_FRICTION_MULT,
  STEEL_STEER_MULT,
  STEEL_RAM_DAMAGE_MULT,
  STEEL_WALL_BREAK_SPEED_COST,
  STONE_RAM_DAMAGE_MULT,
  STONE_WALL_BREAK_SPEED_COST,
} from "../constants";

/** `iron` = the Ball Form potion is up (p.ironT), which is what makes it steel. */
function setMaterial(m: MarbleMaterial | null, iron = true): void {
  state.dbgMaterialEnabled = true;
  state.player = {
    ...(state.player ?? {}),
    material: m,
    materialT: m ? 5 : 0,
    ironT: iron ? 5 : 0,
  } as typeof state.player;
}

beforeEach(() => {
  setMaterial(null);
});

describe("steel is GATED on the Ball Form potion, not the default ride", () => {
  it("an ordinary overcharge roll (no potion) keeps the ORIGINAL physics", () => {
    setMaterial(null, false);
    const brk = materialBreakSpeeds();
    expect(brk.wall).toBe(WALL_BREAK_SPEED);
    expect(brk.secret).toBe(SECRET_BREAK_SPEED);
    expect(materialWallBreakCost()).toBe(WALL_BREAK_SPEED_COST);
    expect(materialRamKnockback()).toBe(BALL_RAM_KNOCKBACK);
    expect(materialRamDamageMult()).toBe(1);
    expect(materialFrictionMult()).toBe(1);
    expect(materialSteerMult()).toBe(1);
  });
});

describe("the ball is STEEL while Ball Form is up", () => {
  it("smashes masonry sooner than the old flesh baseline", () => {
    const brk = materialBreakSpeeds();
    expect(brk.wall).toBe(STEEL_WALL_BREAK_SPEED);
    expect(brk.secret).toBe(STEEL_SECRET_BREAK_SPEED);
    // The whole point: a LOWER threshold means walls break more easily.
    expect(brk.wall).toBeLessThan(WALL_BREAK_SPEED);
    expect(brk.secret).toBeLessThan(SECRET_BREAK_SPEED);
  });

  it("keeps more speed when punching through a wall", () => {
    expect(materialWallBreakCost()).toBe(STEEL_WALL_BREAK_SPEED_COST);
    expect(materialWallBreakCost()).toBeGreaterThan(WALL_BREAK_SPEED_COST);
  });

  it("shoves and hurts bodies harder — running things over has mass", () => {
    expect(materialRamKnockback()).toBe(STEEL_RAM_KNOCKBACK);
    expect(materialRamKnockback()).toBeGreaterThan(BALL_RAM_KNOCKBACK);
    expect(materialRamDamageMult()).toBe(STEEL_RAM_DAMAGE_MULT);
    expect(materialRamDamageMult()).toBeGreaterThan(1);
  });

  it("trades agility for weight: carries speed, turns lazier", () => {
    expect(materialFrictionMult()).toBe(STEEL_FRICTION_MULT);
    expect(materialFrictionMult()).toBeLessThan(1); // less speed scrubbed
    expect(materialSteerMult()).toBe(STEEL_STEER_MULT);
    expect(materialSteerMult()).toBeLessThan(1); // harder to turn
  });
});

describe("a material pickup REPLACES steel rather than stacking on it", () => {
  // Regression: the first pass returned steel from every `default:` branch,
  // which silently made diamond/storm/shadow/lava heavy too.
  // DERIVED, not hand-listed. The old literal was `["diamond","shadow","lava"]`
  // — correct when it was written, and quietly incomplete forever after: it is
  // the COMPLEMENT of the mass materials, so every material added since should
  // have appeared here and none did. Deriving it means a 7th material is
  // asserted neutral by default, and if it actually carries a mass override the
  // author has to come here and say so, which is the conversation we want.
  const MASS = ["water", "stone", "storm"];
  const neutralMaterials = MATERIAL_LIST.filter((m) => !MASS.includes(m));

  it("leaves non-mass materials at neutral friction and steering", () => {
    for (const m of neutralMaterials) {
      setMaterial(m);
      expect(materialFrictionMult(), `${m} friction`).toBe(1);
      expect(materialSteerMult(), `${m} steering`).toBe(1);
    }
  });

  it("leaves non-mass materials at the ordinary ram values", () => {
    for (const m of neutralMaterials) {
      setMaterial(m);
      expect(materialRamKnockback(), `${m} knockback`).toBe(BALL_RAM_KNOCKBACK);
      expect(materialRamDamageMult(), `${m} ram dmg`).toBe(1);
      expect(materialWallBreakCost(), `${m} break cost`).toBe(WALL_BREAK_SPEED_COST);
    }
  });

  it("keeps STONE a strict upgrade on steel for both mass axes", () => {
    setMaterial("stone");
    expect(materialRamDamageMult()).toBe(STONE_RAM_DAMAGE_MULT);
    expect(STONE_RAM_DAMAGE_MULT).toBeGreaterThan(STEEL_RAM_DAMAGE_MULT);
    expect(materialWallBreakCost()).toBe(STONE_WALL_BREAK_SPEED_COST);
    expect(STONE_WALL_BREAK_SPEED_COST).toBeGreaterThan(STEEL_WALL_BREAK_SPEED_COST);
  });

  it("still lets DIAMOND own the wall-breaking axis", () => {
    setMaterial("diamond");
    const brk = materialBreakSpeeds();
    // Diamond is the dedicated wall-breaker and must beat bare steel.
    expect(brk.wall).toBeLessThan(STEEL_WALL_BREAK_SPEED);
    expect(brk.secret).toBeLessThan(STEEL_SECRET_BREAK_SPEED);
  });
});
