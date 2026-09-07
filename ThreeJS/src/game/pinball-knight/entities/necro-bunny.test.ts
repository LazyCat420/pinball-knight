import { describe, it, expect, beforeEach } from "vitest";
import { state, type Zombie } from "../state";
import { installGameplayWiring } from "../boot/wiring";
import { damageZombie, setReagentDropHandler, setCoinDropHandler, setCardRollHandler } from "./combat";
import {
  NECRO_HP,
  NECRO_R,
  NECRO_SUMMON_MAX,
  BUNNY_HP,
  BUNNY_R,
  BUNNY_SCALE,
  BUNNY_SPEED_FACTOR,
  BUNNY_PER_SUMMON,
  levelConfig,
} from "../constants";
import { IMPORTED_FACINGS, hasAuthoredFacing } from "../boot/manifest-inventory";
import { IMPORTED_ART, sheetKeyForKind } from "../boot/sheets";
import { SHEET_PAINTERS } from "../render/sheet-painters";
import { KIND_PAINTS } from "../render/monster-portrait";
import { makeNecroPaints } from "../render/monsters/necro";
import { makeBunnyPaints } from "../render/monsters/bunny";
import { drainPendingSummons, queueSummon } from "../spawn/factory";
import { updateZombies, setSummonHandler } from "./zombie";
import { T_FLOOR } from "../engine/grid";

describe("Necromancer & Zombie Mini Bunny Rabbit Summons", () => {
  beforeEach(() => {
    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 64,
            height: 64,
            getContext: () => ({
              createRadialGradient: () => ({ addColorStop() {} }),
              fillRect: () => {},
              clearRect: () => {},
              drawImage: () => {},
              save: () => {},
              restore: () => {},
              setTransform: () => {},
              beginPath: () => {},
              arc: () => {},
              fill: () => {},
              stroke: () => {},
              fillStyle: "",
            }),
          };
        }
        return {};
      },
    };
    state.scene = { add() {}, remove() {} } as any;
    state.level = 1;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(T_FLOOR),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
    state.zombies = [];
    state.player = null;
    const mockTexture = () => ({
      needsUpdate: false,
      repeat: { set() {} },
      offset: { set() {} },
      matrixAutoUpdate: false,
    });
    const mockClips = new Map<string, number[]>([
      ["S:idle", [0]],
      ["S:walk", [0]],
      ["S:attack", [0]],
      ["S:death", [0]],
    ]);
    state.sheets = {
      zombie: {
        cols: 4,
        rows: 4,
        frames: {},
        clips: mockClips,
        texture: {
          clone: mockTexture,
          repeat: { set() {} },
          offset: { set() {} },
        },
      } as any,
    } as any;
    state.zombieVariantSheets = [state.sheets.zombie!];
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
    } as any;
  });

  it("registers necromancer as a native sprite sheet and uses makeNecroPaints", () => {
    expect(hasAuthoredFacing("necro", "S")).toBe(true);
    expect(IMPORTED_FACINGS.necro).toEqual(["S"]);
    expect(IMPORTED_ART.necromancer).toBe("necro");
    expect(sheetKeyForKind("necromancer")).toBe("necromancer");

    // Both sheet painters and portrait painters use makeNecroPaints
    expect(SHEET_PAINTERS.necromancer).toBe(makeNecroPaints);
    expect(KIND_PAINTS.necromancer).toBe(makeNecroPaints);

    const necroPaints = makeNecroPaints();
    expect(necroPaints.S).toBeDefined();
    expect(necroPaints.S?.idle?.length).toBeGreaterThan(0);
    expect(necroPaints.S?.attack?.length).toBeGreaterThan(0);
    expect(necroPaints.S?.death?.length).toBeGreaterThan(0);
  });

  it("procedural cel-painter makeBunnyPaints provides full directional clips", () => {
    const bunnyPaints = makeBunnyPaints();
    for (const dir of ["S", "N", "E"] as const) {
      expect(bunnyPaints[dir]).toBeDefined();
      expect(bunnyPaints[dir]?.idle?.length).toBeGreaterThan(0);
      expect(bunnyPaints[dir]?.walk?.length).toBeGreaterThan(0);
      expect(bunnyPaints[dir]?.attack?.length).toBeGreaterThan(0);
      expect(bunnyPaints[dir]?.death?.length).toBeGreaterThan(0);
    }
  });

  it("drainPendingSummons spawns zombie mini bunny rabbits with mini stats", () => {
    expect(state.zombies.length).toBe(0);

    // Queue a summon at (5, 5)
    queueSummon(5, 5);

    // Drain summons
    drainPendingSummons();

    // Must spawn BUNNY_PER_SUMMON (2) mini bunnies
    expect(state.zombies.length).toBe(BUNNY_PER_SUMMON);

    const baseSpeed = levelConfig(state.level).zombieSpeed;
    for (const bunny of state.zombies) {
      expect(bunny.mini).toBe(true);
      expect(bunny.hp).toBe(BUNNY_HP);
      expect(bunny.bodyR).toBe(BUNNY_R);
      expect(bunny.aggro).toBe(true);
      expect(bunny.speed).toBeCloseTo(baseSpeed * BUNNY_SPEED_FACTOR, 2);
      expect(bunny.sprite.mesh.scale.x).toBeCloseTo(BUNNY_SCALE, 2);
      expect(bunny.sprite.mesh.scale.y).toBeCloseTo(BUNNY_SCALE, 2);

      // Clustered around the summon point (5, 5)
      expect(Math.hypot(bunny.x - 5, bunny.z - 5)).toBeLessThan(1.5);
    }
  });

  it("zombie mini bunny rabbits die in a single 1-HP hit", () => {
    installGameplayWiring({
      spawnReaper: () => {},
      dropBossReward: () => {},
      startLevel: () => {},
      descend: () => {},
      onPlayerDeath: () => {},
      exitDungeonGame: () => {},
    });
    setReagentDropHandler(() => {});
    setCoinDropHandler(() => {});
    setCardRollHandler(() => {});

    queueSummon(4, 4);
    drainPendingSummons();

    const bunny = state.zombies[0];
    expect(bunny.hp).toBe(1);
    expect(bunny.mode).toBe("idle");

    // Hit with 1 damage
    damageZombie(bunny, 1, 0, 0, 0);

    expect(bunny.hp).toBe(0);
    expect(bunny.mode).toBe("dead");
  });

  it("respects NECRO_SUMMON_MAX throttle when surrounding horde is dense", () => {
    let summonTriggered = false;
    setSummonHandler(() => {
      summonTriggered = true;
    });

    const mockSprite = () => ({
      setBlobVisible: () => {},
      setTint: () => {},
      setSheet: () => {},
      mesh: { position: { set: () => {} } },
    });

    const mockAnim = () => ({
      play: () => {},
      setFacing: () => {},
      getFacing: () => "S",
    });

    // Spawn 1 necromancer at (0, 0) in attack mode
    const necro: Zombie = {
      x: 0,
      z: 0,
      hp: NECRO_HP,
      bodyR: NECRO_R,
      kind: "necromancer",
      mode: "attack",
      windupT: 0.05, // near finish of windup
      cooldown: 0,
      speed: 1,
      aggro: true,
      sprite: mockSprite(),
      anim: mockAnim(),
    } as any;

    // Place NECRO_SUMMON_MAX living zombies within 7 units
    const denseHorde: Zombie[] = [];
    for (let i = 0; i < NECRO_SUMMON_MAX; i++) {
      denseHorde.push({
        x: 0.5 * (i + 1),
        z: 0,
        hp: 5,
        bodyR: 0.4,
        kind: "zombie",
        mode: "chase",
        sprite: mockSprite(),
        anim: mockAnim(),
      } as any);
    }

    state.zombies = [necro, ...denseHorde];
    state.player = { x: 3, z: 0, hp: 10, sprite: mockSprite() } as any;

    // Update with dt that completes the windup (0.05 - 0.1 < 0)
    updateZombies(0.1);

    // Because nearby living count >= NECRO_SUMMON_MAX, summon must NOT be queued
    expect(summonTriggered).toBe(false);
  });
});
