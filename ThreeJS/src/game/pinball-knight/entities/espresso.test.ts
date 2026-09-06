import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STATS, espressoTeacupSpin } from "./zombie";
import {
  ESPRESSO_HP,
  ESPRESSO_DAMAGE,
  ESPRESSO_SPIN_RANGE,
  ESPRESSO_SPIN_DEFLECT,
  ESPRESSO_SPILL_RADIUS,
  ESPRESSO_SPILL_DAMAGE,
  ESPRESSO_SPILL_LIFE,
  ESPRESSO_CONTACT_RANGE,
} from "../constants/enemies";
import { state, resetState, type Player, type Zombie } from "../state";
import { triggerEspressoSpill, killZombie, setCoinDropHandler, setReagentDropHandler } from "./combat";
import { spawnFloorFx, updateFloorFx } from "./floor-fx";
import { installGameplayWiring } from "../boot/wiring";
import { makeEspressoPaints } from "../render/monsters/espresso";
import type { Grid } from "../maze/generator";

function makeGrid(): Grid {
  return { w: 10, h: 10, t: new Uint8Array(100), shapes: new Uint8Array(100) };
}

function mockSprite() {
  return {
    setBlobVisible: () => {},
    setTint: () => {},
    setSheet: () => {},
    mesh: { position: { set: () => {} } },
  };
}

function mockAnim(initial = "idle") {
  let cur = initial;
  return {
    play: (anim: string) => {
      cur = anim;
    },
    getFacing: () => "S",
    current: () => cur,
  };
}

describe("walking espresso cup monster mechanics & sprite sheet", () => {
  beforeEach(() => {
    resetState();
    state.grid = makeGrid();
    state.scene = { add() {}, remove() {} } as unknown as typeof state.scene;
    state.dbgMaterialFloorFx = true;
    state.floorFx = [];
    state.zombies = [];
    state.vfx = {
      burst: () => {},
      smoke: () => {},
      sparks: () => {},
      blood: () => {},
      ember: () => {},
      mote: () => {},
      dust: () => {},
      heal: () => {},
      steam: () => {},
      slash: () => {},
      slashCircle: () => {},
      sporeCloud: () => {},
      bolt: () => {},
      trail: () => {},
      damage: () => {},
      ring: () => {},
    } as any;

    installGameplayWiring({
      spawnReaper: () => {},
      dropBossReward: () => {},
      startLevel: () => {},
      descend: () => {},
      onPlayerDeath: () => {},
      exitDungeonGame: () => {},
    });
    setCoinDropHandler(() => {});
    setReagentDropHandler(() => {});
  });

  it("publishes valid espresso-S sprite sheet manifest with 4 animation clips", () => {
    const jsonPath = join(process.cwd(), "public/sprites/espresso-S.json");
    expect(existsSync(jsonPath), "public/sprites/espresso-S.json must exist").toBe(true);

    const data = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(data.name).toBe("espresso");
    expect(data.dir).toBe("S");

    const clipNames = data.rows.map((r: { clip: string }) => r.clip);
    expect(clipNames).toEqual(["idle", "walk", "attack", "death"]);
    expect(data.rows.length).toBe(4);

    for (const row of data.rows) {
      expect(row.cells.length).toBe(4);
      for (const cell of row.cells) {
        expect(cell.length).toBe(4);
        expect(cell[2]).toBeGreaterThan(cell[0]);
        expect(cell[3]).toBeGreaterThan(cell[1]);
      }
    }
  });

  it("configures STATS.espresso with 4 HP, fast run speed and melee teacup spin stats", () => {
    const st = STATS.espresso;
    expect(st.ranged).toBe(false);
    expect(st.contactRange).toBe(ESPRESSO_CONTACT_RANGE);
    expect(st.contactRange).toBe(1.2);
    expect(ESPRESSO_HP).toBe(4);
    expect(ESPRESSO_DAMAGE).toBe(1);
    expect(ESPRESSO_SPIN_RANGE).toBe(1.3);
    expect(ESPRESSO_SPIN_DEFLECT).toBe(12.0);
    expect(ESPRESSO_SPILL_RADIUS).toBe(1.8);
    expect(ESPRESSO_SPILL_LIFE).toBe(5.5);
    expect(ESPRESSO_SPILL_DAMAGE).toBe(1);
  });

  it("executes espressoTeacupSpin like Disneyland spinning teacups, flinging droplets and deflecting player", () => {
    const p = {
      x: 5,
      z: 5.8,
      hp: 10,
      momX: 0,
      momZ: 1,
      momSpeed: 2.0,
      facing: "S",
      attackT: -1,
      didHit: false,
      comboLanded: false,
      cooldown: 0,
      iframes: 0,
      flashT: 0,
      sprite: mockSprite(),
    } as unknown as Player;
    state.player = p;

    let playedAnim = "";
    const cup = {
      kind: "espresso",
      x: 5,
      z: 5,
      hp: 4,
      mode: "chase",
      windupT: 0,
      cooldown: 0,
      speed: 1.35,
      flashT: 0,
      aggro: true,
      burnT: 0,
      anim: {
        play: (anim: string) => {
          playedAnim = anim;
        },
        getFacing: () => "S",
      } as any,
      sprite: mockSprite(),
    } as unknown as Zombie;
    state.zombies = [cup];

    const rings: any[] = [];
    const bursts: any[] = [];
    const dusts: any[] = [];

    state.vfx = {
      slashCircle: (...args: any[]) => rings.push(args),
      ring: (...args: any[]) => rings.push(args),
      sparks: () => {},
      burst: (...args: any[]) => bursts.push(args),
      dust: (...args: any[]) => dusts.push(args),
      smoke: (...args: any[]) => dusts.push(args),
      blood: () => {},
      damage: () => {},
    } as unknown as typeof state.vfx;

    // Execute the teacup spin
    espressoTeacupSpin(cup, 0.8, ESPRESSO_SPIN_RANGE);

    // 1. Attack anim played
    expect(playedAnim).toBe("attack");

    // 2. Disneyland spinning teacup slashCircle / ring VFX triggered
    expect(rings.length).toBeGreaterThanOrEqual(1);

    // 3. Centrifugal coffee droplets and steam dust puffs triggered
    expect(bursts.length).toBeGreaterThanOrEqual(1);
    expect(dusts.length).toBeGreaterThanOrEqual(1);

    // 4. Player took damage and got deflected
    expect(p.hp).toBe(10 - ESPRESSO_DAMAGE);
    expect(p.momZ).toBeCloseTo(1, 1);
    expect(p.momSpeed).toBe(ESPRESSO_SPIN_DEFLECT);
  });

  it("spills scalding boiling coffee upon death that creates a coffee decal and burns anyone in the area", () => {
    const p = {
      x: 5.5,
      z: 5,
      hp: 10,
      flashT: 0,
      iframes: 0,
      sprite: mockSprite(),
    } as unknown as Player;
    state.player = p;

    const nearbyGoblin = {
      kind: "goblin",
      x: 5.2,
      z: 5.3,
      hp: 5,
      burnT: 0,
      flashT: 0,
      sprite: mockSprite(),
      anim: mockAnim(),
    } as unknown as Zombie;

    const farZombie = {
      kind: "zombie",
      x: 9,
      z: 9,
      hp: 5,
      burnT: 0,
      flashT: 0,
      sprite: mockSprite(),
      anim: mockAnim(),
    } as unknown as Zombie;

    state.zombies = [nearbyGoblin, farZombie];

    // Trigger espresso spill at (5, 5)
    triggerEspressoSpill(5, 5);

    // 1. Spawns "coffee" floor decal
    expect(state.floorFx.length).toBe(1);
    const puddle = state.floorFx[0];
    expect(puddle.kind).toBe("coffee");
    expect(puddle.x).toBe(5);
    expect(puddle.z).toBe(5);
    expect(puddle.radius).toBe(ESPRESSO_SPILL_RADIUS);
    expect(puddle.hostile).toBe(true);

    // 2. Scalds nearby player: damage
    expect(p.hp).toBe(10 - ESPRESSO_SPILL_DAMAGE);

    // 3. Scalds nearby enemy monster: damage + burn status
    expect(nearbyGoblin.hp).toBe(5 - ESPRESSO_SPILL_DAMAGE);
    expect(nearbyGoblin.burnT).toBeGreaterThan(0);

    // 4. Far enemy monster was not hit
    expect(farZombie.hp).toBe(5);
    expect(farZombie.burnT).toBe(0);
  });

  it("killZombie on espresso monster triggers scalding coffee spill", () => {
    const dyingCup = {
      kind: "espresso",
      x: 6,
      z: 4,
      hp: 0,
      mode: "chase",
      anim: mockAnim(),
      sprite: mockSprite(),
    } as unknown as Zombie;
    state.zombies = [dyingCup];

    killZombie(dyingCup);

    // Floor hazard spawned at cup's location
    const coffeeHazard = state.floorFx.find((fx) => fx.kind === "coffee");
    expect(coffeeHazard).toBeDefined();
    expect(coffeeHazard?.x).toBe(6);
    expect(coffeeHazard?.z).toBe(4);
  });

  it("coffee floor hazard continues burning anyone walking into it", () => {
    const p = {
      x: 5.2,
      z: 5,
      hp: 8,
      flashT: 0,
      iframes: 0,
      sprite: mockSprite(),
    } as unknown as Player;
    state.player = p;

    const walker = {
      kind: "skeleton",
      x: 5,
      z: 5.2,
      hp: 4,
      burnT: 0,
      flashT: 0,
      sprite: mockSprite(),
      anim: mockAnim(),
    } as unknown as Zombie;
    state.zombies = [walker];

    // Add coffee puddle at (5, 5)
    spawnFloorFx("coffee", 5, 5, ESPRESSO_SPILL_RADIUS, 5.0, true);
    expect(state.floorFx.length).toBe(1);

    // Advance floor fx by 1 second (past the 0.5s tick interval)
    updateFloorFx(1.0);

    // Both player and monster take burn damage from the active coffee puddle
    expect(p.hp).toBeLessThan(8);
    expect(walker.hp).toBeLessThan(4);
    expect(walker.burnT).toBeGreaterThan(0);
  });

  it("procedural cel-painter delivers all facings and required clips", () => {
    const paints = makeEspressoPaints();
    for (const dir of ["S", "N", "E"] as const) {
      expect(paints[dir]).toBeDefined();
      expect(paints[dir].idle?.length).toBeGreaterThan(0);
      expect(paints[dir].walk?.length).toBeGreaterThan(0);
      expect(paints[dir].attack?.length).toBeGreaterThan(0);
      expect(paints[dir].death?.length).toBeGreaterThan(0);
    }
  });
});
