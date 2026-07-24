import { describe, it, expect, beforeEach } from "vitest";
import { ABILITIES, ABILITY_IDS, canCast, tickAbilities, getMana, spawnPulseWave } from "./abilities";
import { state } from "./state";
import { MANA_MAX, MANA_REGEN, ARCANE_PULSE_DAMAGE, PULSE_WAVE_DUR, FLIPPER_TRAIL_LIFE, MAGNET_PULSE_EVERY, TIMECRAWL_SMEAR } from "./constants";

/**
 * The active-skill mana economy is pure logic (no WebGL / audio on these paths),
 * so we can exercise it directly. castAbility itself pokes audio, so it's driven
 * only through canCast + tickAbilities here.
 */

function stubPlayer(mana: number): void {
  // Only the numeric fields the ability upkeep reads — cast through unknown.
  state.player = { mana, magnetAuraT: 0, bladeStormT: 0, bladeStormTickT: 0 } as unknown as typeof state.player;
  state.groundItems = [];
  state.abilityCd = {} as Record<(typeof ABILITY_IDS)[number], number>;
  state.abilitySlots = ["flippercharge", "arcanepulse"];
  state.slowT = 0;
}

describe("ability table integrity", () => {
  it("has exactly the six ids, all coherent and affordable within the pool", () => {
    expect(ABILITY_IDS).toHaveLength(6);
    for (const id of ABILITY_IDS) {
      const def = ABILITIES[id];
      expect(def.id).toBe(id);
      expect(def.cost).toBeGreaterThan(0);
      expect(def.cost).toBeLessThanOrEqual(MANA_MAX); // never unaffordable on a full pool
      expect(def.cooldown).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("mana regen + cooldowns (tickAbilities)", () => {
  beforeEach(() => stubPlayer(0));

  it("regenerates mana toward the cap and clamps there", () => {
    tickAbilities(1);
    expect(getMana()).toBeCloseTo(MANA_REGEN, 5);
    tickAbilities(1000); // way past full
    expect(getMana()).toBe(MANA_MAX);
  });

  it("decays ability cooldowns to zero, never below", () => {
    state.abilityCd.flippercharge = 2;
    tickAbilities(0.5);
    expect(state.abilityCd.flippercharge).toBeCloseTo(1.5, 5);
    tickAbilities(5);
    expect(state.abilityCd.flippercharge).toBe(0);
  });

  it("counts Time Crawl down and stops at zero", () => {
    state.slowT = 1;
    tickAbilities(0.4);
    expect(state.slowT).toBeCloseTo(0.6, 5);
    tickAbilities(5);
    expect(state.slowT).toBe(0);
  });
});

describe("arcane pulse shockwave (spawnPulseWave + tickAbilities)", () => {
  // Ghost-kind foes with vulnT up: they pass damageZombie's gates, take the hit
  // and get phase-shoved without ever touching the (stubbed) grid's walls.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fakeGhost(x: number, z: number): any {
    return {
      kind: "ghost",
      vulnT: 5,
      hp: 100,
      mode: "chase",
      x,
      z,
      flashT: 0,
      aggro: false,
      sprite: { setTint() {}, mesh: { position: { set() {} } } },
    };
  }

  beforeEach(() => {
    stubPlayer(0);
    state.grid = {} as never; // truthy so damageZombie doesn't early-return
    state.vfx = undefined as never;
  });

  it("hits foes only when the expanding wave front reaches them", () => {
    const near = fakeGhost(0.5, 0);
    const far = fakeGhost(3.0, 0);
    state.zombies = [near, far];
    spawnPulseWave(0, 0);

    tickAbilities(0.05); // wave front ≈0.7 world units out — only `near` is crossed
    expect(near.hp).toBe(100 - ARCANE_PULSE_DAMAGE);
    expect(far.hp).toBe(100);

    tickAbilities(PULSE_WAVE_DUR); // wave completes — `far` crossed exactly once
    expect(far.hp).toBe(100 - ARCANE_PULSE_DAMAGE);
    expect(near.hp).toBe(100 - ARCANE_PULSE_DAMAGE); // never double-hit
  });
});

describe("flipper charge fire trail (tickAbilities)", () => {
  it("drops one burning floor scar per NEW tile crossed, none once slow", () => {
    stubPlayer(0);
    const p = state.player!;
    state.zombies = [];
    state.floorFx = [];
    state.vfx = undefined as never;
    state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
    state.dbgMaterialFloorFx = true;
    Object.assign(p, { x: 100.5, z: 100.5, momSpeed: 12, fireTrailT: 0.6, sprite: { mesh: {} } });

    tickAbilities(0.016); // fresh tile → one scar
    expect(state.floorFx.length).toBe(1);
    expect(state.floorFx[0].kind).toBe("fire");
    expect(state.floorFx[0].life).toBe(FLIPPER_TRAIL_LIFE);

    tickAbilities(0.016); // same tile → still one
    expect(state.floorFx.length).toBe(1);

    p.x = 101.5; // crossed into the next tile
    tickAbilities(0.016);
    expect(state.floorFx.length).toBe(2);

    p.x = 102.5;
    p.momSpeed = 1; // below the trail threshold — the fire gutters
    tickAbilities(0.016);
    expect(state.floorFx.length).toBe(2);
  });
});

describe("canCast gating", () => {
  it("allows a cast only when equipped, off cooldown, and affordable", () => {
    stubPlayer(MANA_MAX);
    expect(canCast(0)).toBe(true); // flippercharge, full pool, no cd

    // on cooldown → blocked
    state.abilityCd.flippercharge = 1;
    expect(canCast(0)).toBe(false);
    state.abilityCd.flippercharge = 0;
    expect(canCast(0)).toBe(true);

    // too little mana → blocked (arcanepulse costs 35)
    stubPlayer(10);
    expect(canCast(1)).toBe(false);

    // empty slot → blocked
    stubPlayer(MANA_MAX);
    state.abilitySlots = [null, null];
    expect(canCast(0)).toBe(false);
  });
});

/**
 * SUSTAINED BUFF LOOKS. Blade Storm, Magnet Aura and Time Crawl each used to
 * draw nothing at all in the world — a one-shot spark on cast and then an
 * invisible five seconds. These pin that each one now emits its OWN signature
 * while it runs, on its own beat, through the real vfx surface.
 */
describe("sustained buff visuals", () => {
  interface Calls {
    blades: number;
    ringsInward: number;
    bolts: number;
    ghosts: number;
  }
  function spyVfx(): Calls {
    const c: Calls = { blades: 0, ringsInward: 0, bolts: 0, ghosts: 0 };
    state.vfx = {
      blades: () => void c.blades++,
      ring: (...args: unknown[]) => void (args[6] ? c.ringsInward++ : 0),
      bolt: () => void c.bolts++,
      ghost: () => void c.ghosts++,
      sparks: () => {},
      burst: () => {},
      blood: () => {},
      ember: () => {},
      mote: () => {},
      dust: () => {},
      slash: () => {},
      damage: () => {},
      update: () => {},
      dispose: () => {},
    } as unknown as typeof state.vfx;
    return c;
  }

  it("Blade Storm keeps a visible blade ring alive every frame it runs", () => {
    stubPlayer(0);
    const c = spyVfx();
    state.zombies = [];
    const p = state.player!;
    p.bladeStormT = 1;
    p.bladeStormTickT = 1; // no damage tick inside this window
    tickAbilities(0.016);
    tickAbilities(0.016);
    expect(c.blades).toBe(2); // keep-alive: one refresh per frame, not per tick
    p.bladeStormT = 0;
    tickAbilities(0.016);
    expect(c.blades).toBe(2); // lapsed → the blades stop being drawn
    state.vfx = null;
  });

  it("Magnet Aura draws COLLAPSING rings and leashes nearby loot with arcs", () => {
    stubPlayer(0);
    const c = spyVfx();
    const p = state.player!;
    p.x = 0;
    p.z = 0;
    p.magnetAuraT = 3;
    state.groundItems = [
      { kind: "potion", x: 2, z: 0, sprite: { mesh: { position: { x: 2, z: 0 } } } },
    ] as unknown as typeof state.groundItems;
    // A full beat's worth of dt always crosses the pulse timer, whatever phase
    // a previous test left it in (the beat is module-local and re-seeded on cast).
    tickAbilities(MAGNET_PULSE_EVERY);
    expect(c.ringsInward).toBe(1);
    expect(c.bolts).toBe(1); // an arc onto the item being reeled in
    tickAbilities(0.016); // still inside the fresh beat → no second ring
    expect(c.ringsInward).toBe(1);
    state.vfx = null;
  });

  it("Time Crawl smears the HORDE (an afterimage per live foe), not just the caster", () => {
    stubPlayer(0);
    const c = spyVfx();
    const p = state.player!;
    p.x = 0;
    p.z = 0;
    state.slowT = 2;
    state.zombies = [
      { mode: "chase", sprite: { mesh: {} } },
      { mode: "chase", sprite: { mesh: {} } },
      { mode: "dead", sprite: { mesh: {} } }, // corpses don't smear
    ] as unknown as typeof state.zombies;
    tickAbilities(TIMECRAWL_SMEAR);
    expect(c.ghosts).toBe(2);
    tickAbilities(0.016); // inside the fresh beat
    expect(c.ghosts).toBe(2);
    state.zombies = [];
    state.vfx = null;
  });
});
