import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  ASCII_HUMAN_HP,
  ASCII_HUMAN_R,
  ASCII_HUMAN_SPEED_FACTOR,
  ASCII_MERGE_THRESHOLD,
  ASCII_MERGE_RADIUS,
  GIANT_ASCII_HP,
  GIANT_ASCII_R,
  GIANT_ASCII_SPEED_FACTOR,
  GIANT_ASCII_FROM_LEVEL,
  GIANT_ASCII_DAMAGE,
  GIANT_ASCII_SLAM_RADIUS,
  GIANT_ASCII_WINDUP,
  GIANT_ASCII_COOLDOWN,
} from "../constants/enemies";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import { DMG_BY_KIND, killZombie } from "./combat";
import { PAIN_BY_KIND } from "./stagger";
import { MOVEMENT_BY_KIND } from "./enemy-rules";
import { STATS, convertMonsterToAsciiHuman, giantAsciiGroundSmash, updateAsciiMerge } from "./zombie";
import { SPAWNABLE } from "../debug-panel";
import { makeGiantAsciiHumanPaints } from "../render/monsters/giant-ascii-human";
import { spawnGiantAsciiHuman } from "../spawn/factory";
import { T_FLOOR } from "../engine/grid";
import type { Zombie, Player } from "../state";
import { state } from "../state";

const origDoc = (globalThis as any).document;

function setupMockDocument() {
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
}

describe("Giant ASCII Titan — Constants & Registrations", () => {
  beforeEach(() => {
    setupMockDocument();
  });
  afterEach(() => {
    (globalThis as any).document = origDoc;
  });

  it("has correct stats and constants defined", () => {
    expect(ASCII_MERGE_THRESHOLD).toBe(4);
    expect(ASCII_MERGE_RADIUS).toBe(6.0);
    expect(GIANT_ASCII_HP).toBe(120);
    expect(GIANT_ASCII_R).toBe(0.95);
    expect(GIANT_ASCII_SPEED_FACTOR).toBe(0.75);
    expect(GIANT_ASCII_FROM_LEVEL).toBe(4);
    expect(GIANT_ASCII_DAMAGE).toBe(3);
    expect(GIANT_ASCII_SLAM_RADIUS).toBe(2.8);
    expect(GIANT_ASCII_WINDUP).toBe(0.85);
    expect(GIANT_ASCII_COOLDOWN).toBe(2.4);
  });

  it("is registered in bestiary with icon and label", () => {
    const titanInfo = KIND_INFO.giant_ascii_human;
    expect(titanInfo).toBeDefined();
    expect(titanInfo.label).toBe("ASCII Titan");
    expect(titanInfo.icon).toBe("👾");
    expect(titanInfo.blurb).toContain("cascading matrix code");
  });

  it("is registered in reagent drops", () => {
    const drops = ENEMY_DROPS.giant_ascii_human;
    expect(drops).toBeDefined();
    expect(drops.some((d) => d.id === "lodestone")).toBe(true);
    expect(drops.some((d) => d.id === "ironshard")).toBe(true);
    expect(drops.some((d) => d.id === "glass")).toBe(true);
  });

  it("is configured in KIND_SKIN with scale 2.4", () => {
    expect(KIND_SKIN.giant_ascii_human?.scale).toBe(2.4);
  });

  it("has combat damage, stagger, movement, and zombie stats configured", () => {
    expect(DMG_BY_KIND.giant_ascii_human).toBe(GIANT_ASCII_DAMAGE);
    expect(PAIN_BY_KIND.giant_ascii_human).toBe(0.1);
    expect(MOVEMENT_BY_KIND.giant_ascii_human).toBe("chase");

    expect(STATS.giant_ascii_human.ranged).toBe(false);
    expect(STATS.giant_ascii_human.bodyR).toBe(GIANT_ASCII_R);
    expect(STATS.giant_ascii_human.windup).toBe(GIANT_ASCII_WINDUP);
    expect(STATS.giant_ascii_human.cooldown).toBe(GIANT_ASCII_COOLDOWN);
  });

  it("is present in the debug panel spawnable roster", () => {
    const entry = SPAWNABLE.find((e) => e.kind === "giant_ascii_human");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("AsciiTitan");
  });

  it("produces valid procedural cel-paints", () => {
    const paints = makeGiantAsciiHumanPaints();
    expect(paints.S).toBeDefined();
    expect(paints.S.idle).toHaveLength(4);
    expect(paints.S.walk).toHaveLength(4);
    expect(paints.S.attack).toHaveLength(4);
    expect(paints.S.death).toHaveLength(4);

    const canvas = (globalThis as any).document.createElement("canvas");
    expect(() => paints.S.attack[2](canvas.getContext("2d"))).not.toThrow();
  });
});

describe("ASCII Zombie Swarm Merge State Machine", () => {
  beforeEach(() => {
    setupMockDocument();
    state.scene = new THREE.Scene();
    state.zombies = [];
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
      armorHelmet: 0,
      armorChest: 0,
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      sprite: { setTint: () => {} },
    } as unknown as Player;
  });

  afterEach(() => {
    (globalThis as any).document = origDoc;
  });

  function createDummyAsciiHuman(x: number, z: number): Zombie {
    return {
      x,
      z,
      hp: ASCII_HUMAN_HP,
      maxHp: ASCII_HUMAN_HP,
      kind: "ascii_human",
      mode: "chase",
      speed: 1.6 * ASCII_HUMAN_SPEED_FACTOR,
      bodyR: ASCII_HUMAN_R,
      windupT: 0,
      cooldown: 0,
      aggro: true,
      anim: {
        play: () => {},
        setFacing: () => {},
        getFacing: () => "S",
      } as any,
      sprite: {
        setTint: () => {},
        setBlobVisible: () => {},
        mesh: {
          position: {
            x: 0,
            y: 0,
            z: 0,
            set: function (nx: number, ny: number, nz: number) {
              this.x = nx;
              this.y = ny;
              this.z = nz;
            },
          },
        },
      } as any,
    } as unknown as Zombie;
  }

  it("does not trigger merge when fewer than 4 ASCII humans exist", () => {
    state.zombies = [
      createDummyAsciiHuman(10, 10),
      createDummyAsciiHuman(10.5, 10),
      createDummyAsciiHuman(10, 10.5),
    ];

    updateAsciiMerge(0.1);

    expect(state.zombies.every((z) => !z.merging)).toBe(true);
    expect(state.zombies.every((z) => z.mode === "chase")).toBe(true);
  });

  it("triggers merge state when 4 ASCII humans are clustered within radius", () => {
    state.zombies = [
      createDummyAsciiHuman(10, 10),
      createDummyAsciiHuman(11, 10),
      createDummyAsciiHuman(10, 11),
      createDummyAsciiHuman(11, 11),
    ];

    updateAsciiMerge(0.1);

    expect(state.zombies.every((z) => z.merging === true)).toBe(true);
    expect(state.zombies.every((z) => (z.mode as string) === "merging")).toBe(true);
    expect(state.zombies[0].mergeTarget).toBeDefined();
    expect(state.zombies[0].mergeTarget?.x).toBeCloseTo(10.5, 1);
    expect(state.zombies[0].mergeTarget?.z).toBeCloseTo(10.5, 1);
  });

  it("converges merging humans towards centroid and completes merge into Giant ASCII Titan", () => {
    const h1 = createDummyAsciiHuman(10, 10);
    const h2 = createDummyAsciiHuman(11, 10);
    const h3 = createDummyAsciiHuman(10, 11);
    const h4 = createDummyAsciiHuman(11, 11);
    state.zombies = [h1, h2, h3, h4];

    // Initiate merge
    updateAsciiMerge(0.01);
    expect(h1.merging).toBe(true);

    // Run convergence steps until they reach centroid
    for (let i = 0; i < 40; i++) {
      updateAsciiMerge(0.1);
      if (state.zombies.some((z) => z.kind === "giant_ascii_human")) break;
    }

    // Merging humans should be removed, and Giant ASCII Titan spawned
    const titan = state.zombies.find((z) => z.kind === "giant_ascii_human");
    expect(titan, "Giant ASCII Titan must be spawned upon merge completion").toBeDefined();
    expect(titan?.hp).toBe(GIANT_ASCII_HP);
    expect(titan?.bodyR).toBe(GIANT_ASCII_R);
    expect(titan?.x).toBeCloseTo(10.5, 1);
    expect(titan?.z).toBeCloseTo(10.5, 1);

    // Old small humans must be cleared
    const smallHumans = state.zombies.filter((z) => z.kind === "ascii_human");
    expect(smallHumans).toHaveLength(0);
  });

  it("does not initiate another merge while a Giant ASCII Titan is already alive", () => {
    state.zombies = [
      spawnGiantAsciiHuman(15, 15)!,
      createDummyAsciiHuman(10, 10),
      createDummyAsciiHuman(11, 10),
      createDummyAsciiHuman(10, 11),
      createDummyAsciiHuman(11, 11),
    ];

    updateAsciiMerge(0.1);

    const smallHumans = state.zombies.filter((z) => z.kind === "ascii_human");
    expect(smallHumans.every((z) => !z.merging)).toBe(true);
  });
});

describe("Giant ASCII Titan — Ground Smash & Combat", () => {
  beforeEach(() => {
    setupMockDocument();
    state.scene = new THREE.Scene();
    state.zombies = [];
    state.grid = {
      w: 20,
      h: 20,
      t: new Uint8Array(400).fill(T_FLOOR),
      shapes: new Uint8Array(400),
      arcs: [],
    } as any;
    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      armorHelmet: 0,
      armorChest: 0,
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      sprite: {
        mesh: { position: { set: () => {} } },
        setTint: () => {},
      },
    } as unknown as Player;
  });

  afterEach(() => {
    (globalThis as any).document = origDoc;
  });

  it("deals AoE damage, screen shake, and knockback to player within slam radius", () => {
    const titan: Zombie = {
      x: 10.5,
      z: 10.5,
      hp: GIANT_ASCII_HP,
      maxHp: GIANT_ASCII_HP,
      kind: "giant_ascii_human",
      mode: "chase",
      speed: 1.2,
      bodyR: GIANT_ASCII_R,
      anim: { play: () => {} } as any,
    } as unknown as Zombie;

    state.zombies.push(titan);
    state.shakeT = 0;

    giantAsciiGroundSmash(titan, 0.7, 1.4);

    expect(state.player.hp).toBeLessThan(10);
    expect(state.shakeT).toBeGreaterThanOrEqual(0.45);
  });

  it("staggers and damages nearby lower-tier zombies via friendly-fire shockwave", () => {
    const titan: Zombie = {
      x: 10,
      z: 10,
      hp: GIANT_ASCII_HP,
      maxHp: GIANT_ASCII_HP,
      kind: "giant_ascii_human",
      mode: "chase",
      speed: 1.2,
      bodyR: GIANT_ASCII_R,
      anim: { play: () => {} } as any,
    } as unknown as Zombie;

    const nearbyGoblin: Zombie = {
      x: 11.2,
      z: 10,
      hp: 10,
      maxHp: 10,
      kind: "goblin",
      mode: "chase",
      speed: 1.0,
      bodyR: 0.4,
      anim: { play: () => {} } as any,
      sprite: {
        mesh: { position: { set: () => {} } },
        setTint: () => {},
      } as any,
    } as unknown as Zombie;

    state.zombies.push(titan, nearbyGoblin);

    giantAsciiGroundSmash(titan, 3.0, 1.4);

    expect(nearbyGoblin.hp).toBeLessThan(10);
  });

  it("protects Giant ASCII Titan from viral infection by smaller ASCII humans", () => {
    const titan: Zombie = {
      x: 10,
      z: 10,
      hp: GIANT_ASCII_HP,
      kind: "giant_ascii_human",
      mode: "chase",
    } as unknown as Zombie;

    const canConvert = convertMonsterToAsciiHuman(titan);
    expect(canConvert).toBe(false);
    expect(titan.kind).toBe("giant_ascii_human");
  });

  it("triggers death burst and marks dead upon killZombie", () => {
    const titan: Zombie = {
      x: 10,
      z: 10,
      hp: 0,
      maxHp: GIANT_ASCII_HP,
      kind: "giant_ascii_human",
      mode: "chase",
      anim: { play: () => {}, getFacing: () => "S" } as any,
      sprite: { setTint: () => {}, setBlobVisible: () => {} } as any,
    } as unknown as Zombie;

    killZombie(titan);
    expect(titan.mode).toBe("dead");
  });
});
