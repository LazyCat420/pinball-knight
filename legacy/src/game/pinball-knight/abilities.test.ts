import { describe, it, expect, beforeEach } from "vitest";
import { ABILITIES, ABILITY_IDS, canCast, castAbility, castsInFlight, tickAbilities, getMana, spawnPulseWave, abilityRank, abilityPower, resetAbilityScratch } from "./abilities";
import { state } from "./state";
import { SKILLS } from "./skills";
import { spendSkillPoint, spendAbilityRank, invalidateSkillAgg, playerManaMax } from "./skill-runtime";
import {
  MANA_MAX,
  MANA_REGEN,
  ARCANE_PULSE_DAMAGE,
  PULSE_WAVE_DUR,
  FLIPPER_TRAIL_LIFE,
  MAGNET_PULSE_EVERY,
  TIMECRAWL_SMEAR,
  PINBALL_MAX_SPEED,
  CAST_ANIM,
  ABILITY_RANK_MAX,
  ABILITY_RANK_STEP,
  FROST_RUNE_COUNT,
  BLOOD_PRICE_HP,
} from "./constants";

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
      ring: (...args: unknown[]) => void ((args[5] as { inward?: boolean } | undefined)?.inward ? c.ringsInward++ : 0),
      bolt: () => void c.bolts++,
      ghost: () => void c.ghosts++,
      sparks: () => {},
      burst: () => {},
      blood: () => {},
      ember: () => {},
      mote: () => {},
      dust: () => {},
      slash: () => {},
      sigil: () => {},
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

// ── The wave: cast animation, ability ranks, the table as a battery, keystones ──

/**
 * A fuller player stub than `stubPlayer`. `castAbility` is now driven directly
 * (its audio path no-ops without an AudioContext, so the old "it pokes audio"
 * exemption no longer buys anything and the cast path is the interesting one).
 */
function stubCaster(mana: number): NonNullable<typeof state.player> {
  state.player = {
    mana,
    hp: 6,
    x: 100.5,
    z: 100.5,
    facing: "s",
    momX: 1,
    momZ: 0,
    momSpeed: 0,
    bounceCombo: 0,
    iframes: 0,
    turboT: 0,
    fireTrailT: 0,
    magnetAuraT: 0,
    bladeStormT: 0,
    bladeStormTickT: 0,
    oilT: 0,
    sprite: { mesh: {} },
  } as unknown as NonNullable<typeof state.player>;
  state.groundItems = [];
  state.zombies = [];
  state.projectiles = [];
  state.floorFx = [];
  state.abilityCd = {} as Record<(typeof ABILITY_IDS)[number], number>;
  state.abilityRanks = {} as Record<(typeof ABILITY_IDS)[number], number>;
  state.skillRanks = {};
  state.abilitySlots = ["flippercharge", "arcanepulse"];
  state.slowT = 0;
  state.flashT = 0;
  state.infMana = false;
  state.noCooldown = false;
  state.vfx = undefined as never;
  state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
  state.grid = {} as never;
  state.dbgMaterialFloorFx = true;
  invalidateSkillAgg();
  // Swapping the player out from under a module-local beat is a thing only a
  // test does; clear the scratch so nothing carries between scenarios.
  resetAbilityScratch();
  return state.player!;
}

/** Buy a tree node outright, prerequisites and all, the way the menu would. */
function learn(id: string): void {
  const def = SKILLS[id];
  for (const req of def.requires ?? []) if ((state.skillRanks[req] ?? 0) < 1) learn(req);
  state.skillPoints = def.cost;
  invalidateSkillAgg();
  expect(spendSkillPoint(id).ok, `could not learn ${id}`).toBe(true);
}

describe("a cast is three beats, not one frame", () => {
  beforeEach(() => stubCaster(MANA_MAX));

  it("pays and arms IMMEDIATELY but does not resolve until the wind-up elapses", () => {
    state.abilitySlots = ["timecrawl", null];
    state.unlockedAbilities = ["timecrawl"];
    const p = state.player!;
    expect(castAbility(0)).toBe(true);
    // Paid on the press — a wind-up you can cancel for free is not a commitment.
    expect(p.mana).toBe(MANA_MAX - ABILITIES.timecrawl.cost);
    expect(state.abilityCd.timecrawl).toBeGreaterThan(0);
    expect(castsInFlight()).toBe(1);
    // …and the world has NOT stopped yet. This is the whole point: an opponent
    // gets a readable beat before the effect exists.
    expect(state.slowT).toBe(0);

    tickAbilities(CAST_ANIM.timecrawl.windup * 0.5);
    expect(state.slowT).toBe(0);
    tickAbilities(CAST_ANIM.timecrawl.windup * 0.6); // now past the wind-up
    expect(state.slowT).toBeGreaterThan(0);
  });

  it("fires the effect exactly ONCE and then retires the cast", () => {
    state.abilitySlots = ["bladestorm", null];
    state.unlockedAbilities = ["bladestorm"];
    const p = state.player!;
    castAbility(0);
    tickAbilities(CAST_ANIM.bladestorm.windup + 0.001);
    const firstT = p.bladeStormT;
    expect(firstT).toBeGreaterThan(0);
    // Many more frames: the storm must DECAY, never be re-armed by its own cast.
    for (let i = 0; i < 10; i++) tickAbilities(0.016);
    expect(p.bladeStormT).toBeLessThan(firstT);
    // Past the recovery the cast is gone from the list entirely.
    tickAbilities(CAST_ANIM.bladestorm.recover + 0.05);
    expect(castsInFlight()).toBe(0);
  });

  it("carries the impact frame's flash into the pixel pass, not the key press", () => {
    state.abilitySlots = ["timecrawl", null];
    state.unlockedAbilities = ["timecrawl"];
    castAbility(0);
    expect(state.flashT).toBe(0); // nothing has landed
    tickAbilities(CAST_ANIM.timecrawl.windup + 0.001);
    expect(state.flashT).toBeCloseTo(CAST_ANIM.timecrawl.flash, 5);
  });

  it("goes off where you ARE, not where you stood when you pressed the key", () => {
    state.abilitySlots = ["slickfield", null];
    state.unlockedAbilities = ["slickfield"];
    const p = state.player!;
    castAbility(0);
    p.x = 140.5; // a fast ride carries you a long way in a wind-up
    p.z = 90.5;
    tickAbilities(CAST_ANIM.slickfield.windup + 0.001);
    const pool = state.floorFx.find((f) => f.kind === "oil");
    expect(pool).toBeDefined();
    expect(pool!.x).toBe(140.5);
    expect(pool!.z).toBe(90.5);
  });
});

describe("ability ranks", () => {
  beforeEach(() => stubCaster(MANA_MAX));

  it("cost 1 then 2 then 3 points, cap at ABILITY_RANK_MAX, and need the unlock", () => {
    state.unlockedAbilities = ["arcanepulse"];
    state.skillPoints = 0;
    expect(spendAbilityRank("arcanepulse").ok).toBe(false); // no points

    state.skillPoints = 6;
    expect(spendAbilityRank("arcanepulse").ok).toBe(true);
    expect(state.skillPoints).toBe(5); // rank 1 cost 1
    expect(spendAbilityRank("arcanepulse").ok).toBe(true);
    expect(state.skillPoints).toBe(3); // rank 2 cost 2
    expect(spendAbilityRank("arcanepulse").ok).toBe(true);
    expect(state.skillPoints).toBe(0); // rank 3 cost 3 — six points to max one
    expect(abilityRank("arcanepulse")).toBe(ABILITY_RANK_MAX);

    state.skillPoints = 99;
    expect(spendAbilityRank("arcanepulse").ok).toBe(false); // maxed
    expect(state.skillPoints).toBe(99); // a refused buy costs nothing

    // A spell you have no node for cannot be invested in.
    expect(spendAbilityRank("timecrawl").ok).toBe(false);
  });

  it("is ADDITIVE, not compounding — rank 3 is +75%, never 1.25³", () => {
    state.abilityRanks.arcanepulse = 3;
    expect(abilityPower("arcanepulse")).toBeCloseTo(1 + ABILITY_RANK_STEP * 3, 6);
    expect(abilityPower("arcanepulse")).toBeLessThan(1.25 ** 3);
  });

  it("scales the pulse it fires — a ranked wave bites harder than an unranked one", () => {
    const foe = (): Record<string, unknown> => ({ kind: "ghost", vulnT: 5, hp: 100, mode: "chase", x: 0.5, z: 0, flashT: 0, aggro: false, sprite: { setTint() {}, mesh: { position: { set() {} } } } });
    const plain = foe();
    state.zombies = [plain] as unknown as typeof state.zombies;
    spawnPulseWave(0, 0, 1);
    tickAbilities(0.05);
    const plainHit = 100 - (plain.hp as number);

    const ranked = foe();
    state.zombies = [ranked] as unknown as typeof state.zombies;
    spawnPulseWave(0, 0, 1.75);
    tickAbilities(0.05);
    expect(100 - (ranked.hp as number)).toBeGreaterThan(plainHit);
  });
});

/**
 * RANK 2 IS A RULE, NOT A NUMBER. Each of these asserts the extra OBJECT the
 * rank puts on the floor — the half of the deferred FX list that would
 * otherwise have no supply and never occur in a real run.
 */
describe("rank 2 gives an ability an extra rule", () => {
  beforeEach(() => stubCaster(MANA_MAX));

  function landRank2(id: (typeof ABILITY_IDS)[number]): void {
    state.abilitySlots = [id, null];
    state.unlockedAbilities = [id];
    state.abilityRanks[id] = 2;
    expect(castAbility(0)).toBe(true);
    tickAbilities(CAST_ANIM[id].windup + 0.001);
  }

  it("Arcane Pulse plants a lightning rod (and rank 1 does not)", () => {
    landRank2("arcanepulse");
    expect(state.floorFx.filter((f) => f.kind === "rod")).toHaveLength(1);

    stubCaster(MANA_MAX);
    state.abilitySlots = ["arcanepulse", null];
    state.unlockedAbilities = ["arcanepulse"];
    state.abilityRanks.arcanepulse = 1;
    castAbility(0);
    tickAbilities(CAST_ANIM.arcanepulse.windup + 0.001);
    expect(state.floorFx.filter((f) => f.kind === "rod")).toHaveLength(0);
  });

  it("Time Crawl lays a ring of frost runes at FIXED angles (co-op safe)", () => {
    landRank2("timecrawl");
    const runes = state.floorFx.filter((f) => f.kind === "frost");
    expect(runes).toHaveLength(FROST_RUNE_COUNT);
    // Deterministic placement: re-running the same cast from the same spot must
    // put them in the same places, or two peers disagree about the floor.
    const first = runes.map((f) => [f.x.toFixed(6), f.z.toFixed(6)].join());
    stubCaster(MANA_MAX);
    landRank2("timecrawl");
    const second = state.floorFx.filter((f) => f.kind === "frost").map((f) => [f.x.toFixed(6), f.z.toFixed(6)].join());
    expect(second).toEqual(first);
  });

  it("Slick Field congeals a tar core inside the spill", () => {
    landRank2("slickfield");
    expect(state.floorFx.filter((f) => f.kind === "oil")).toHaveLength(1);
    expect(state.floorFx.filter((f) => f.kind === "tar")).toHaveLength(1);
  });
});

describe("mana from the table (DECLONE §4.4)", () => {
  beforeEach(() => stubCaster(0));

  it("pays per NEW bounce, once, and pays more the faster you took it", () => {
    const p = state.player!;
    p.momSpeed = 0;
    p.bounceCombo = 1;
    tickAbilities(0); // dt 0 → the clock contributes nothing; only the bounce does
    const slow = p.mana;
    expect(slow).toBeGreaterThan(0);

    tickAbilities(0); // same combo reading → nothing more
    expect(p.mana).toBe(slow);

    stubCaster(0);
    const q = state.player!;
    q.momSpeed = PINBALL_MAX_SPEED;
    q.bounceCombo = 1;
    tickAbilities(0);
    expect(q.mana).toBeGreaterThan(slow); // the table pays for speed
  });

  it("re-arms after a lapsed chain instead of going permanently silent", () => {
    const p = state.player!;
    p.bounceCombo = 5;
    tickAbilities(0);
    const afterChain = p.mana;
    p.bounceCombo = 0; // the window lapsed
    tickAbilities(0);
    expect(p.mana).toBe(afterChain);
    p.bounceCombo = 1; // a fresh bounce
    tickAbilities(0);
    expect(p.mana).toBeGreaterThan(afterChain);
  });
});

describe("keystones — a rule change plus a structural drawback", () => {
  beforeEach(() => stubCaster(MANA_MAX));

  it("DYNAMO severs the clock and hands the job to the table", () => {
    learn("dynamo");
    const p = state.player!;
    p.mana = 0;
    tickAbilities(1); // a full second of standing still
    expect(p.mana).toBe(0); // the drawback, in one assertion

    p.bounceCombo = 1;
    tickAbilities(0);
    const dyn = p.mana;
    expect(dyn).toBeGreaterThan(0);

    // …and the same bounce without the keystone pays a fraction of that.
    stubCaster(0);
    const q = state.player!;
    q.bounceCombo = 1;
    tickAbilities(0);
    expect(q.mana).toBeLessThan(dyn);
  });

  it("BLOOD PRICE casts on an empty pool for a heart, and never for the last one", () => {
    learn("bloodprice");
    const p = state.player!;
    p.mana = 0;
    p.hp = 4;
    state.abilitySlots = ["arcanepulse", null];
    state.unlockedAbilities = ["arcanepulse"];
    expect(canCast(0)).toBe(true); // the HUD must not grey out a slot that works
    expect(castAbility(0)).toBe(true);
    expect(p.hp).toBe(4 - BLOOD_PRICE_HP);

    // The soft-failure ledger: a spell may cost a heart, never the last one.
    state.abilityCd.arcanepulse = 0;
    p.hp = 1;
    p.mana = 0;
    expect(canCast(0)).toBe(false);
    expect(castAbility(0)).toBe(false);
    expect(p.hp).toBe(1);
  });

  it("BLOOD PRICE's drawback is real — the pool shrinks and stays castable", () => {
    const before = playerManaMax();
    learn("bloodprice");
    expect(playerManaMax()).toBeLessThan(before);
    // …but never below the priciest ability, or the keystone deletes the system
    // it is supposed to modify.
    const dearest = Math.max(...ABILITY_IDS.map((id) => ABILITIES[id].cost));
    expect(playerManaMax()).toBeGreaterThanOrEqual(dearest);
  });

  it("CINDER WAKE burns the floor at speed, and nothing at a walk", () => {
    learn("cinderwake");
    const p = state.player!;
    p.momSpeed = PINBALL_MAX_SPEED; // momentumT = 1, well past the threshold
    p.x = 200.5;
    tickAbilities(0.016);
    expect(state.floorFx.filter((f) => f.kind === "fire").length).toBe(1);
    p.x = 201.5; // a new tile
    tickAbilities(0.016);
    expect(state.floorFx.filter((f) => f.kind === "fire").length).toBe(2);

    p.momSpeed = 0.5; // a walk
    p.x = 202.5;
    tickAbilities(0.016);
    expect(state.floorFx.filter((f) => f.kind === "fire").length).toBe(2);
  });
});

describe("momentum-aware tree nodes", () => {
  beforeEach(() => stubCaster(MANA_MAX));

  it("OVERDRIVE cools abilities down faster at speed and normally at a walk", () => {
    learn("overdrive");
    const p = state.player!;
    p.momSpeed = 0;
    state.abilityCd.arcanepulse = 2;
    tickAbilities(0.5);
    const walked = state.abilityCd.arcanepulse;
    expect(walked).toBeCloseTo(1.5, 5); // a walk buys exactly the clock

    state.abilityCd.arcanepulse = 2;
    p.momSpeed = PINBALL_MAX_SPEED;
    tickAbilities(0.5);
    expect(state.abilityCd.arcanepulse).toBeLessThan(walked);
  });

  it("KINETIC FOCUS is worth nothing standing still and its printed value at terminal speed", () => {
    learn("kineticfocus");
    const p = state.player!;
    p.momSpeed = 0;
    expect(abilityPower("arcanepulse")).toBeCloseTo(1, 6);
    p.momSpeed = PINBALL_MAX_SPEED;
    expect(abilityPower("arcanepulse")).toBeCloseTo(1.15, 5);
  });
});
