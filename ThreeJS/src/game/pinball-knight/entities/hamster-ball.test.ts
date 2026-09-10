import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import {
  HAMSTER_BALL_HP,
  HAMSTER_BALL_R,
  HAMSTER_BALL_SPEED_FACTOR,
  HAMSTER_BALL_FROM_LEVEL,
  HAMSTER_BALL_DAMAGE,
  HAMSTER_BALL_DEFLECT_SPEED,
  HAMSTER_BALL_WINDUP,
  HAMSTER_BALL_COOLDOWN,
} from "../constants/enemies";
import { KIND_INFO } from "../bestiary";
import { ENEMY_DROPS } from "../reagents";
import { KIND_SKIN } from "../spawn/kind-skin";
import {
  DMG_BY_KIND,
  killZombie,
  hitPlayer,
  deflectOffHamsterBall,
  setHamsterBallDeathHandler,
} from "./combat";
import { PAIN_BY_KIND } from "./stagger";
import { MOVEMENT_BY_KIND, MOMENTUM_GATES } from "./enemy-rules";
import { STATS, updateZombies } from "./zombie";
import { SPAWNABLE } from "../debug-panel";
import { makeHamsterBallPaints } from "../render/monsters/hamster-ball";
import type { Zombie, Player } from "../state";
import type { Grid } from "../maze/generator";
import { state } from "../state";

describe("Hamster Ball Monster — Tables & Registrations", () => {
  it("has correct stats and constants defined", () => {
    expect(HAMSTER_BALL_HP).toBe(16);
    expect(HAMSTER_BALL_R).toBe(0.46);
    expect(HAMSTER_BALL_SPEED_FACTOR).toBe(1.15);
    expect(HAMSTER_BALL_FROM_LEVEL).toBe(2);
    expect(HAMSTER_BALL_DAMAGE).toBe(1);
    expect(HAMSTER_BALL_DEFLECT_SPEED).toBe(14.0);
    expect(HAMSTER_BALL_WINDUP).toBe(0.35);
    expect(HAMSTER_BALL_COOLDOWN).toBe(2.2);
  });

  it("is registered in bestiary with icon and label", () => {
    const info = KIND_INFO.hamster_ball;
    expect(info).toBeDefined();
    expect(info.label).toBe("Hamster Ball");
    expect(info.icon).toBe("🐹");
    expect(info.blurb).toContain("kinetic deflector");
  });

  it("is registered in reagent drops with glass and lodestone", () => {
    const drops = ENEMY_DROPS.hamster_ball;
    expect(drops).toBeDefined();
    expect(drops.some((d) => d.id === "glass")).toBe(true);
    expect(drops.some((d) => d.id === "lodestone")).toBe(true);
  });

  it("is configured in KIND_SKIN with appropriate scale", () => {
    const skin = KIND_SKIN.hamster_ball;
    expect(skin).toBeDefined();
    expect(skin?.scale).toBe(1.12);
  });

  it("has combat damage, stagger, movement, gates, and zombie stats configured", () => {
    expect(DMG_BY_KIND.hamster_ball).toBe(HAMSTER_BALL_DAMAGE);
    expect(PAIN_BY_KIND.hamster_ball).toBe(0.35);
    expect(MOVEMENT_BY_KIND.hamster_ball).toBe("chase");
    expect(MOMENTUM_GATES.hamster_ball).toBeDefined();
    expect(STATS.hamster_ball.ranged).toBe(false);
    expect(STATS.hamster_ball.bodyR).toBe(HAMSTER_BALL_R);
    expect(STATS.hamster_ball.windup).toBe(HAMSTER_BALL_WINDUP);
    expect(STATS.hamster_ball.cooldown).toBe(HAMSTER_BALL_COOLDOWN);
  });

  it("is present in the debug panel spawnable roster", () => {
    const entry = SPAWNABLE.find((e) => e.kind === "hamster_ball");
    expect(entry).toBeDefined();
    expect(entry?.label).toContain("HamsterBall");
  });

  it("generates procedural cel-paints for all facings and clips", () => {
    const paints = makeHamsterBallPaints();
    expect(paints.S).toBeDefined();
    expect(paints.N).toBeDefined();
    expect(paints.E).toBeDefined();

    for (const facing of [paints.S, paints.N, paints.E]) {
      expect(facing.idle?.length).toBeGreaterThan(0);
      expect(facing.walk?.length).toBeGreaterThan(0);
      expect(facing.attack?.length).toBeGreaterThan(0);
      expect(facing.death?.length).toBeGreaterThan(0);
    }
  });
});

describe("Hamster Ball Monster — Dual-Mode Collision & Ball Shattering", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.projectiles = [];
    state.zombies = [];
    state.floorFx = [];
    const t = new Uint8Array(400);
    t.fill(1);
    state.grid = {
      w: 20,
      h: 20,
      t,
      shapes: new Uint8Array(400),
    } as unknown as Grid;
    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      facing: "S",
      invulnT: 0,
      iframes: 0,
      shieldT: 0,
      stoneT: 0,
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      bounceCombo: 0,
      bounceComboT: 0,
      gear: {},
      sprite: {
        mesh: { position: { set: () => {} } },
        setTint: () => {},
      },
      dead: false,
    } as unknown as Player;
  });

  it("damages the player in normal mode (momSpeed <= 0)", () => {
    const mockHamster = {
      nid: "hamster_1",
      kind: "hamster_ball",
      x: 10.2,
      z: 10.2,
      hp: HAMSTER_BALL_HP,
      speed: 1.0,
      mode: "chase",
      sprite: {
        mesh: { position: { x: 10.2, y: 0, z: 10.2, set: () => {} } },
        setTint: () => {},
        setBlobVisible: () => {},
      },
      anim: {
        play: () => {},
        setFacing: () => {},
        getFacing: () => "S",
        currentClip: "idle",
      },
    } as unknown as Zombie;

    // Normal mode: momSpeed = 0
    const p = state.player!;
    p.momSpeed = 0;
    const initialHp = p.hp;

    hitPlayer(mockHamster);
    expect(p.hp).toBe(initialHp - HAMSTER_BALL_DAMAGE);
  });

  it("acts as a kinetic bumper deflector in pinball mode (momSpeed > 0)", () => {
    const mockHamster = {
      nid: "hamster_2",
      kind: "hamster_ball",
      x: 10.0,
      z: 9.0, // Hamster is north of player
      hp: HAMSTER_BALL_HP,
      speed: 1.0,
      mode: "chase",
      sprite: {
        mesh: { position: { x: 10.0, y: 0, z: 9.0, set: () => {} } },
        setTint: () => {},
        setBlobVisible: () => {},
      },
      anim: {
        play: () => {},
        setFacing: () => {},
        getFacing: () => "S",
        currentClip: "idle",
      },
    } as unknown as Zombie;

    // In pinball mode: player rolling north into the hamster ball
    const p = state.player!;
    p.x = 10.0;
    p.z = 9.8;
    p.momX = 0;
    p.momZ = -1;
    p.momSpeed = 6.0;
    p.bounceCombo = 1;

    deflectOffHamsterBall(mockHamster);

    // Deflected away from hamster ball: player kicked with high speed
    expect(p.momSpeed).toBeGreaterThanOrEqual(HAMSTER_BALL_DEFLECT_SPEED);
    expect(p.bounceCombo).toBe(2);
    expect(p.bounceComboT).toBeGreaterThan(0);
    expect(p.iframes).toBeGreaterThanOrEqual(0.25);
    // Player should be deflected southward (+Z direction away from z.z = 9.0)
    expect(p.momZ).toBeGreaterThan(0);
  });

  it("breaks and shatters the exercise ball upon death", () => {
    let ballBroken = false;
    let breakX = 0;
    let breakZ = 0;

    setHamsterBallDeathHandler((x, z) => {
      ballBroken = true;
      breakX = x;
      breakZ = z;
    });

    const mockHamster = {
      nid: "hamster_3",
      kind: "hamster_ball",
      x: 7.5,
      z: 8.5,
      hp: 0,
      speed: 1.0,
      mode: "chase",
      sprite: {
        mesh: { position: { x: 7.5, y: 0, z: 8.5, set: () => {} } },
        setTint: () => {},
        setBlobVisible: () => {},
      },
      anim: {
        play: () => {},
        setFacing: () => {},
        getFacing: () => "S",
        currentClip: "idle",
      },
    } as unknown as Zombie;

    killZombie(mockHamster);

    expect(mockHamster.mode).toBe("dead");
    expect(ballBroken).toBe(true);
    expect(breakX).toBe(7.5);
    expect(breakZ).toBe(8.5);
  });
});
