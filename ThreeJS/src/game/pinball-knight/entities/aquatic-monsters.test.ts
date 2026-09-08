import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS } from "./zombie";
import {
  SHARK_TRAPPER_HP, SHARK_TRAPPER_R, SHARK_TRAPPER_HOOK_RANGE, SHARK_TRAPPER_WINDUP, SHARK_TRAPPER_COOLDOWN, SHARK_TRAPPER_PULL_SPEED,
  DOLPHIN_BRAWLER_HP, DOLPHIN_BRAWLER_R, DOLPHIN_BRAWLER_CONTACT_RANGE, DOLPHIN_BRAWLER_WINDUP, DOLPHIN_BRAWLER_COOLDOWN, DOLPHIN_BRAWLER_UPPERCUT_LAUNCH,
  OCTOPUS_GUNNER_HP, OCTOPUS_GUNNER_R, OCTOPUS_GUNNER_FIRE_RANGE, OCTOPUS_GUNNER_WINDUP, OCTOPUS_GUNNER_COOLDOWN,
  CLOWNFISH_MOB_HP, CLOWNFISH_MOB_R, CLOWNFISH_MOB_FIRE_RANGE, CLOWNFISH_MOB_WINDUP, CLOWNFISH_MOB_COOLDOWN, CLOWNFISH_MOB_BURST_COUNT, CLOWNFISH_MOB_BURST_INTERVAL,
  LIONFISH_MOB_HP, LIONFISH_MOB_R, LIONFISH_MOB_FIRE_RANGE, LIONFISH_MOB_WINDUP, LIONFISH_MOB_COOLDOWN,
  ANGLERFISH_MOB_HP, ANGLERFISH_MOB_R, ANGLERFISH_MOB_FIRE_RANGE, ANGLERFISH_MOB_WINDUP, ANGLERFISH_MOB_COOLDOWN,
  PUFFERFISH_MOB_HP, PUFFERFISH_MOB_R, PUFFERFISH_MOB_FIRE_RANGE, PUFFERFISH_MOB_WINDUP, PUFFERFISH_MOB_COOLDOWN,
  SWORDFISH_MOB_HP, SWORDFISH_MOB_R, SWORDFISH_MOB_HARPOON_RANGE, SWORDFISH_MOB_WINDUP, SWORDFISH_MOB_COOLDOWN,
  MORAY_MOB_HP, MORAY_MOB_R, MORAY_MOB_FIRE_RANGE, MORAY_MOB_WINDUP, MORAY_MOB_COOLDOWN,
  SEAHORSE_MOB_HP, SEAHORSE_MOB_R, SEAHORSE_MOB_FIRE_RANGE, SEAHORSE_MOB_WINDUP, SEAHORSE_MOB_COOLDOWN,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie, type EnemyKind } from "../state";
import { isAquaticMonster, updateAquaticMonster } from "./aquatic-monsters";
import {
  burstPufferSpikes,
  updateProjectiles,
} from "./projectiles";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { PAIN_BY_KIND } from "./stagger";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { HP_BY_KIND } from "../spawn/factory";
import { IMPORTED_FACINGS } from "../boot/manifest-inventory";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import type { SheetKey } from "../boot/sheets";
import { installSpriteTestDom } from "../testkit/atlas-census";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  const g: Grid = { w: 20, h: 20, t: new Uint8Array(400), shapes: new Uint8Array(400) };
  g.t.fill(1); // walkable
  return g;
}

const AQUATIC_KINDS: EnemyKind[] = [
  "shark_trapper",
  "dolphin_brawler",
  "octopus_gunner",
  "clownfish_mob",
  "lionfish_mob",
  "anglerfish_mob",
  "pufferfish_mob",
  "swordfish_mob",
  "moray_mob",
  "seahorse_mob",
];

function makeDummyZombie(kind: EnemyKind, x = 5, z = 5): Zombie {
  return {
    nid: String(Math.floor(Math.random() * 10000) + 1),
    kind,
    x,
    z,
    hp: HP_BY_KIND[kind] ?? 10,
    maxHp: HP_BY_KIND[kind] ?? 10,
    speed: 2,
    cooldown: 0,
    windupT: 0,
    mode: "chase",
    aggro: true,
    sprite: {
      mesh: { position: { set: () => {}, x: 0, y: 0, z: 0 } },
      setTint: () => {},
    } as any,
    anim: {
      play: () => {},
      setFacing: () => {},
    } as any,
  } as unknown as Zombie;
}

describe("Aquatic & Mafia Monsters Integration and Behavioral Test Suite", () => {
  let restoreDom: () => void;
  let grid: Grid;

  beforeAll(() => {
    restoreDom = installSpriteTestDom();
  });

  afterAll(() => {
    restoreDom?.();
  });

  beforeEach(() => {
    resetState();
    grid = makeGrid();
    state.grid = grid;
    state.scene = {
      add: () => {},
      remove: () => {},
    } as unknown as typeof state.scene;
    state.projectiles = [];
    state.zombies = [];
    state.floorFx = [];
    state.vfx = {
      burst: () => {},
      smoke: () => {},
      sparks: () => {},
      blood: () => {},
      damage: () => {},
      dust: () => {},
    } as any;

    state.player = {
      x: 5,
      z: 8,
      hp: 10,
      maxHp: 10,
      rollT: 0,
      iframes: 0,
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      didHit: false,
      attackT: -1,
      facing: "S",
      gold: 0,
      webbedT: 0,
      sprite: {
        mesh: { position: { set: () => {}, x: 0, y: 0, z: 0 } },
        setTint: () => {},
      },
    } as unknown as Player;
  });

  it("publishes valid sprite sheet manifests and pngs for all 10 monsters", () => {
    for (const kind of AQUATIC_KINDS) {
      const jsonPath = join(process.cwd(), `public/sprites/${kind}-S.json`);
      const pngPath = join(process.cwd(), `public/sprites/${kind}-S.png`);
      expect(existsSync(jsonPath), `public/sprites/${kind}-S.json must exist`).toBe(true);
      expect(existsSync(pngPath), `public/sprites/${kind}-S.png must exist`).toBe(true);

      const raw = readFileSync(jsonPath, "utf-8");
      const manifest = JSON.parse(raw);
      expect(manifest.name).toBe(kind);
      expect(manifest.dir).toBe("S");

      const clips = manifest.rows.map((r: any) => r.clip);
      expect(clips).toContain("idle");
      expect(clips).toContain("walk");
      expect(clips).toContain("attack");
      expect(clips).toContain("death");

      for (const row of manifest.rows) {
        expect(row.cells.length).toBe(4);
      }
    }
  });

  it("registers all 10 monsters across all compile-enforced core tables", () => {
    for (const kind of AQUATIC_KINDS) {
      // 1. STATS
      expect(STATS[kind], `STATS.${kind} must be defined`).toBeDefined();
      expect(STATS[kind].bodyR).toBeGreaterThan(0);
      expect(STATS[kind].contactRange).toBeGreaterThan(0);
      expect(STATS[kind].windup).toBeGreaterThan(0);
      expect(STATS[kind].cooldown).toBeGreaterThan(0);

      // 2. MOVEMENT_BY_KIND
      expect(MOVEMENT_BY_KIND[kind], `MOVEMENT_BY_KIND.${kind} must be defined`).toBeDefined();

      // 3. PAIN_BY_KIND
      expect(PAIN_BY_KIND[kind], `PAIN_BY_KIND.${kind} must be defined`).toBeDefined();

      // 4. HP_BY_KIND
      expect(HP_BY_KIND[kind], `HP_BY_KIND.${kind} must be defined`).toBeGreaterThan(0);

      // 5. KIND_SKIN
      expect(KIND_SKIN[kind], `KIND_SKIN.${kind} must be defined`).toBeDefined();

      // 6. KIND_INFO (Bestiary)
      expect(KIND_INFO[kind], `KIND_INFO.${kind} must be defined`).toBeDefined();
      expect(KIND_INFO[kind].label.length).toBeGreaterThan(0);

      // 7. ENEMY_DROPS
      expect(ENEMY_DROPS[kind], `ENEMY_DROPS.${kind} must be defined`).toBeDefined();

      // 8. SHEET_PAINTERS
      expect(SHEET_PAINTERS[kind as SheetKey], `SHEET_PAINTERS.${kind} must be defined`).toBeDefined();

      // 9. IMPORTED_FACINGS
      expect(IMPORTED_FACINGS[kind], `IMPORTED_FACINGS.${kind} must be defined`).toContain("S");
    }
  });

  it("isAquaticMonster recognizes all 10 kinds and rejects others", () => {
    for (const kind of AQUATIC_KINDS) {
      expect(isAquaticMonster(kind)).toBe(true);
    }
    expect(isAquaticMonster("zombie")).toBe(false);
    expect(isAquaticMonster("spider")).toBe(false);
    expect(isAquaticMonster("dracula")).toBe(false);
  });

  // ── 1. SHARK TRAPPER ──────────────────────────────────────────────
  it("Shark Trapper: hooks player with fishing rod and reels player in", () => {
    const z = makeDummyZombie("shark_trapper", 5, 5);
    state.zombies.push(z);
    const p = state.player!;
    p.x = 5;
    p.z = 9; // 4 tiles away (within hook range 6.0)

    z.cooldown = 0;
    // Tick AI with windup duration to trigger attack
    const res = updateAquaticMonster(z, p, SHARK_TRAPPER_WINDUP, grid);
    expect(res).toBe(true);
    expect(state.projectiles.length).toBe(1);
    expect(state.projectiles[0].kind).toBe("fishing_hook");

    // Reeling tether pulls player toward shark
    z.hookTetherT = 1.2;
    updateAquaticMonster(z, p, 0.1, grid);
    expect(p.momSpeed).toBe(SHARK_TRAPPER_PULL_SPEED);
    expect(p.momZ).toBeLessThan(0); // pulled toward shark (z = 5 < 9)

    // Roll breaks tether
    p.rollT = 0.3;
    updateAquaticMonster(z, p, 0.016, grid);
    expect(z.hookTetherT).toBe(0);
  });

  // ── 2. DOLPHIN BRAWLER ────────────────────────────────────────────
  it("Dolphin Brawler: executes 3-hit boxing combo ending with pinball uppercut launch", () => {
    const z = makeDummyZombie("dolphin_brawler", 5, 5);
    const p = state.player!;
    p.x = 5;
    p.z = 5.5; // close range <= 0.85

    // Hit 1: jab
    z.cooldown = 0;
    updateAquaticMonster(z, p, DOLPHIN_BRAWLER_WINDUP, grid);
    expect(z.dolphinComboStep).toBe(2);

    // Hit 2: cross
    updateAquaticMonster(z, p, 0.25, grid);
    expect(z.dolphinComboStep).toBe(3);

    // Hit 3: pinball uppercut
    updateAquaticMonster(z, p, 0.35, grid);
    expect(z.dolphinComboStep).toBe(1);
    expect(p.momSpeed).toBe(DOLPHIN_BRAWLER_UPPERCUT_LAUNCH);
  });

  // ── 3. OCTOPUS MOB BOSS ───────────────────────────────────────────
  it("Octopus Gunner: fires 8-directional revolver barrage and deploys ink smokescreen", () => {
    const z = makeDummyZombie("octopus_gunner", 10, 10);
    const p = state.player!;
    p.x = 10;
    p.z = 13; // within 6.5 range

    z.cooldown = 0;
    updateAquaticMonster(z, p, OCTOPUS_GUNNER_WINDUP, grid);

    // 8 bullets spawned
    const octoBullets = state.projectiles.filter((proj) => proj.kind === "octo_bullet");
    expect(octoBullets.length).toBe(8);

    // Ink smokescreen floor hazard created
    const inkHazards = state.floorFx.filter((fx) => fx.kind === "ink");
    expect(inkHazards.length).toBe(1);
    expect(inkHazards[0].radius).toBeGreaterThan(0);
  });

  // ── 4. CLOWNFISH MOBSTER ──────────────────────────────────────────
  it("Clownfish Mobster: delivers 4-round tommy-gun strafe burst", () => {
    const z = makeDummyZombie("clownfish_mob", 5, 5);
    const p = state.player!;
    p.x = 5;
    p.z = 8; // within 5.5 range

    z.cooldown = 0;
    // Trigger burst start
    updateAquaticMonster(z, p, CLOWNFISH_MOB_WINDUP, grid);
    expect(z.clownBurstCount).toBe(CLOWNFISH_MOB_BURST_COUNT);

    // Fire all rounds of the burst
    while ((z.clownBurstCount ?? 0) > 0) {
      updateAquaticMonster(z, p, CLOWNFISH_MOB_BURST_INTERVAL, grid);
    }
    expect(state.projectiles.filter((pr) => pr.kind === "fish_bullet").length).toBe(CLOWNFISH_MOB_BURST_COUNT);
  });

  // ── 5. LIONFISH ENFORCER ──────────────────────────────────────────
  it("Lionfish Enforcer: fires 5-way spread of venom spines", () => {
    const z = makeDummyZombie("lionfish_mob", 6, 6);
    const p = state.player!;
    p.x = 6;
    p.z = 9; // within 4.5 range

    z.cooldown = 0;
    updateAquaticMonster(z, p, LIONFISH_MOB_WINDUP, grid);

    const spines = state.projectiles.filter((pr) => pr.kind === "lion_spine");
    expect(spines.length).toBe(5);
  });

  // ── 6. ANGLERFISH HITMAN ──────────────────────────────────────────
  it("Anglerfish Hitman: flashes lure to stun when close and fires high-velocity sniper bullet", () => {
    const z = makeDummyZombie("anglerfish_mob", 5, 5);
    const p = state.player!;
    p.x = 5;
    p.z = 7; // distance 2 <= 4.0

    z.cooldown = 0;
    updateAquaticMonster(z, p, ANGLERFISH_MOB_WINDUP, grid);
    expect(p.webbedT).toBeGreaterThan(0);

    const sniperBullets = state.projectiles.filter((pr) => pr.kind === "magnum_bullet");
    expect(sniperBullets.length).toBe(1);
  });

  // ── 7. PUFFERFISH CAPO ────────────────────────────────────────────
  it("Pufferfish Capo: fires blunderbuss slug and bursts into 360-degree spike nova on death", () => {
    const z = makeDummyZombie("pufferfish_mob", 8, 8);
    const p = state.player!;
    p.x = 8;
    p.z = 11; // within 5.0 range

    // Ranged slug
    z.cooldown = 0;
    updateAquaticMonster(z, p, PUFFERFISH_MOB_WINDUP, grid);
    expect(state.projectiles.filter((pr) => pr.kind === "puffer_slug").length).toBe(1);

    // Death spike nova
    burstPufferSpikes(z.x, z.z);
    const spikes = state.projectiles.filter((pr) => pr.kind === "puffer_spike");
    expect(spikes.length).toBe(8);
  });

  // ── 8. SWORDFISH MOBSTER ──────────────────────────────────────────
  it("Swordfish Mobster: wields harpoon speargun at range and lunges at close quarters (NO handheld sword)", () => {
    const z = makeDummyZombie("swordfish_mob", 5, 5);
    const p = state.player!;

    // Speargun bolt at range (dist 5 <= 6.5)
    p.x = 5;
    p.z = 10;
    z.cooldown = 0;
    updateAquaticMonster(z, p, SWORDFISH_MOB_WINDUP, grid);
    expect(state.projectiles.filter((pr) => pr.kind === "spear_bolt").length).toBe(1);

    // Bill lunge at close range (dist 2 <= 3.0)
    p.x = 5;
    p.z = 7;
    z.cooldown = 0;
    updateAquaticMonster(z, p, SWORDFISH_MOB_WINDUP, grid);
    expect(z.swordLungeT).toBeGreaterThan(0);
  });

  // ── 9. MORAY EEL MOBSTER ──────────────────────────────────────────
  it("Moray Eel Mobster: fires twin shock orbs and creates persistent electric floor hazards", () => {
    const z = makeDummyZombie("moray_mob", 7, 7);
    const p = state.player!;
    p.x = 7;
    p.z = 10; // within 5.5 range

    z.cooldown = 0;
    updateAquaticMonster(z, p, MORAY_MOB_WINDUP, grid);

    const shockOrbs = state.projectiles.filter((pr) => pr.kind === "electric_bullet");
    expect(shockOrbs.length).toBe(2);

    // Bullet impact creates shock floor effect
    updateProjectiles(0.65);
    const shockHazards = state.floorFx.filter((fx) => fx.kind === "shock");
    expect(shockHazards.length).toBeGreaterThan(0);
  });

  // ── 10. SEAHORSE MOBSTER ──────────────────────────────────────────
  it("Seahorse Gunner: lobs high-angle water mortar shell over walls", () => {
    const z = makeDummyZombie("seahorse_mob", 4, 4);
    const p = state.player!;
    p.x = 4;
    p.z = 9; // within 6.5 range

    z.cooldown = 0;
    updateAquaticMonster(z, p, SEAHORSE_MOB_WINDUP, grid);

    const mortars = state.projectiles.filter((pr) => pr.kind === "water_mortar");
    expect(mortars.length).toBe(1);
    expect(mortars[0].targetX).toBe(p.x);
    expect(mortars[0].targetZ).toBe(p.z);
  });
});
