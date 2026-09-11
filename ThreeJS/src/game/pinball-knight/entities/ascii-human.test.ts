import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  ASCII_HUMAN_HP,
  ASCII_HUMAN_R,
  ASCII_HUMAN_SPEED_FACTOR,
  ASCII_HUMAN_FROM_LEVEL,
  ASCII_HUMAN_DAMAGE,
  ASCII_HUMAN_WINDUP,
  ASCII_HUMAN_COOLDOWN,
  COMPUTER_SCREEN_HP,
  COMPUTER_SCREEN_R,
  COMPUTER_SCREEN_COOLDOWN,
  COMPUTER_SCREEN_MAX_CHILDREN,
} from "../constants/enemies";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND } from "./combat";
import { PAIN_BY_KIND } from "./stagger";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { STATS, convertMonsterToAsciiHuman, updateZombies } from "./zombie";
import { SPAWNABLE } from "../debug-panel";
import { makeAsciiHumanPaints } from "../render/monsters/ascii-human";
import { makeComputerScreenPaints } from "../render/monsters/computer-screen";
import { queueAsciiHuman, drainPendingAsciiHumans, makeZombie } from "../spawn/factory";
import { debugSpawn } from "../dev/debug-actions";
import { sheetFor } from "../boot/sheets";
import { T_FLOOR } from "../engine/grid";
import type { Zombie, Player } from "../state";
import { state } from "../state";

describe("ASCII Binary Human & Computer Screen — Tables & Registrations", () => {
  it("has correct stats and constants defined", () => {
    expect(ASCII_HUMAN_HP).toBe(20);
    expect(ASCII_HUMAN_R).toBe(0.44);
    expect(ASCII_HUMAN_SPEED_FACTOR).toBe(1.1);
    expect(ASCII_HUMAN_FROM_LEVEL).toBe(4);
    expect(ASCII_HUMAN_DAMAGE).toBe(1);
    expect(ASCII_HUMAN_WINDUP).toBe(0.35);
    expect(ASCII_HUMAN_COOLDOWN).toBe(0.85);

    expect(COMPUTER_SCREEN_HP).toBe(40);
    expect(COMPUTER_SCREEN_R).toBe(0.65);
    expect(COMPUTER_SCREEN_COOLDOWN).toBe(3.5);
    expect(COMPUTER_SCREEN_MAX_CHILDREN).toBe(5);
  });

  it("is registered in bestiary with icon and label", () => {
    const humanInfo = KIND_INFO.ascii_human;
    expect(humanInfo).toBeDefined();
    expect(humanInfo.label).toBe("Binary Human");
    expect(humanInfo.icon).toBe("👤");
    expect(humanInfo.blurb).toContain("digitized");

    const screenInfo = KIND_INFO.computer_screen;
    expect(screenInfo).toBeDefined();
    expect(screenInfo.label).toBe("CRT Terminal");
    expect(screenInfo.icon).toBe("🖥️");
    expect(screenInfo.blurb).toContain("manifests");
  });

  it("is registered in reagent drops with lodestone and ironshard", () => {
    const humanDrops = ENEMY_DROPS.ascii_human;
    expect(humanDrops).toBeDefined();
    expect(humanDrops.some((d) => d.id === "lodestone")).toBe(true);

    const screenDrops = ENEMY_DROPS.computer_screen;
    expect(screenDrops).toBeDefined();
    expect(screenDrops.some((d) => d.id === "ironshard")).toBe(true);
    expect(screenDrops.some((d) => d.id === "glass")).toBe(true);
  });

  it("is configured in KIND_SKIN with scale", () => {
    expect(KIND_SKIN.ascii_human?.scale).toBe(1.05);
    expect(KIND_SKIN.computer_screen?.scale).toBe(1.2);
  });

  it("has combat damage, stagger, movement, and zombie stats configured", () => {
    expect(DMG_BY_KIND.ascii_human).toBe(ASCII_HUMAN_DAMAGE);
    expect(DMG_BY_KIND.computer_screen).toBe(0);

    expect(PAIN_BY_KIND.ascii_human).toBe(0.35);
    expect(PAIN_BY_KIND.computer_screen).toBe(0.1);

    expect(MOVEMENT_BY_KIND.ascii_human).toBe("chase");
    expect(MOVEMENT_BY_KIND.computer_screen).toBe("rooted");

    expect(STATS.ascii_human.ranged).toBe(false);
    expect(STATS.ascii_human.windup).toBe(ASCII_HUMAN_WINDUP);
    expect(STATS.ascii_human.cooldown).toBe(ASCII_HUMAN_COOLDOWN);

    expect(STATS.computer_screen.ranged).toBe(false);
    expect(STATS.computer_screen.cooldown).toBe(COMPUTER_SCREEN_COOLDOWN);
  });

  it("is present in the debug panel spawnable roster", () => {
    const humanEntry = SPAWNABLE.find((e) => e.kind === "ascii_human");
    expect(humanEntry).toBeDefined();
    expect(humanEntry?.label).toContain("AsciiHuman");

    const screenEntry = SPAWNABLE.find((e) => e.kind === "computer_screen");
    expect(screenEntry).toBeDefined();
    expect(screenEntry?.label).toContain("Computer");
  });

  it("generates procedural cel paints without errors", () => {
    const humanPaints = makeAsciiHumanPaints();
    expect(humanPaints.S.idle).toBeDefined();
    expect(humanPaints.S.attack).toBeDefined();
    expect(humanPaints.S.death).toBeDefined();

    const screenPaints = makeComputerScreenPaints();
    expect(screenPaints.S.idle).toBeDefined();
    expect(screenPaints.S.attack).toBeDefined();
    expect(screenPaints.S.death).toBeDefined();
  });
});

describe("Computer Screen Spawner & ASCII Human AI Mechanics", () => {
  beforeEach(() => {
    const dummyCtx = {
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      drawImage: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      setTransform: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      ellipse: () => {},
      rect: () => {},
      roundRect: () => {},
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: () => ({ width: 10 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        width: w,
        height: h,
      }),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        width: w,
        height: h,
      }),
      putImageData: () => {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
    };

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "canvas") {
          return {
            width: 128,
            height: 128,
            getContext: () => dummyCtx,
          };
        }
        return {};
      },
    };

    state.scene = new THREE.Scene();
    state.zombies = [];
    state.level = 4;
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(T_FLOOR),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
    state.player = {
      x: 5,
      z: 5,
      hp: 10,
      maxHp: 10,
      momX: 0,
      momZ: 0,
      momSpeed: 0,
      iframes: 0,
    } as unknown as Player;
  });

  it("spawns ASCII humans via queueAsciiHuman and drainPendingAsciiHumans", () => {
    queueAsciiHuman(6, 6, "screen1");
    expect(state.zombies.length).toBe(0);

    drainPendingAsciiHumans();
    expect(state.zombies.length).toBe(1);
    const spawned = state.zombies[0];
    expect(spawned.kind).toBe("ascii_human");
    expect(spawned.spawnerNid).toBe("screen1");
    expect(spawned.hp).toBe(ASCII_HUMAN_HP);
  });

  it("computer_screen periodically emits ASCII humans up to max children cap", () => {
    const sheet = sheetFor("computer_screen");
    const comp = makeZombie(sheet, 10, 10, 0, { kind: "computer_screen", hp: COMPUTER_SCREEN_HP });
    comp.spawnTimer = 0.1; // almost ready to spawn
    state.zombies.push(comp);

    // Update zombie loop
    updateZombies(0.15);

    // drainPendingAsciiHumans should yield 1 new ascii_human
    drainPendingAsciiHumans();
    expect(state.zombies.length).toBe(2);
    const child = state.zombies.find((z) => z.kind === "ascii_human");
    expect(child).toBeDefined();
    expect(child?.spawnerNid).toBe(comp.nid);

    // Now test cap: fill with max children
    for (let k = 1; k < COMPUTER_SCREEN_MAX_CHILDREN; k++) {
      queueAsciiHuman(10 + k, 10, comp.nid);
    }
    drainPendingAsciiHumans();
    const childrenCount = state.zombies.filter((z) => z.spawnerNid === comp.nid).length;
    expect(childrenCount).toBe(COMPUTER_SCREEN_MAX_CHILDREN);

    // With childrenCount at cap, timer reaching 0 will NOT spawn more
    comp.spawnTimer = 0.05;
    updateZombies(0.1);
    drainPendingAsciiHumans();
    const afterCapCount = state.zombies.filter((z) => z.spawnerNid === comp.nid).length;
    expect(afterCapCount).toBe(COMPUTER_SCREEN_MAX_CHILDREN);
  });

  it("convertMonsterToAsciiHuman converts a normal monster into an ASCII human", () => {
    const sheet = sheetFor("zombie");
    const victim = makeZombie(sheet, 7, 7, 1.2, { kind: "zombie", hp: 15 });
    state.zombies.push(victim);

    const converted = convertMonsterToAsciiHuman(victim);
    expect(converted).toBe(true);
    expect(victim.kind).toBe("ascii_human");
    expect(victim.hp).toBe(ASCII_HUMAN_HP);
    expect(victim.baseTint).toBe(0x22ff55);
  });

  it("convertMonsterToAsciiHuman does not convert bosses, pins, computer screens, or already infected monsters", () => {
    const bossSheet = sheetFor("brute");
    const boss = makeZombie(bossSheet, 8, 8, 1, { kind: "brute", boss: true });
    expect(convertMonsterToAsciiHuman(boss)).toBe(false);

    const compSheet = sheetFor("computer_screen");
    const comp = makeZombie(compSheet, 9, 9, 0, { kind: "computer_screen" });
    expect(convertMonsterToAsciiHuman(comp)).toBe(false);

    const humanSheet = sheetFor("ascii_human");
    const human = makeZombie(humanSheet, 10, 10, 1.5, { kind: "ascii_human" });
    expect(convertMonsterToAsciiHuman(human)).toBe(false);

    const deadZombie = makeZombie(bossSheet, 11, 11, 1, { kind: "zombie", hp: 0 });
    deadZombie.mode = "dead";
    expect(convertMonsterToAsciiHuman(deadZombie)).toBe(false);
  });

  it("debugSpawn('ascii_human') spawns a computer screen terminal and an initial ASCII human", () => {
    const result = debugSpawn({ kind: "ascii_human", count: 1 });
    expect(result.spawned).toBe(1);

    // The placed entity in state.zombies should be a computer_screen spawner
    const comp = state.zombies.find((z) => z.kind === "computer_screen");
    expect(comp).toBeDefined();

    // Drain the pending initial ASCII human
    drainPendingAsciiHumans();
    const human = state.zombies.find((z) => z.kind === "ascii_human");
    expect(human).toBeDefined();
    expect(human?.spawnerNid).toBe(comp?.nid);
  });
});
