import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { state, Player, Zombie } from "../state";
import { STATS, updateZombies } from "./zombie";
import {
  BRUTE_HP,
  BRUTE_R,
  BRUTE_THROW_RANGE,
  BRUTE_DUMBBELL_DAMAGE,
} from "../constants";

describe("Brute Combat AI & Dumbbell Throwing Mechanics", () => {
  beforeEach(() => {
    state.scene = new THREE.Scene();
    state.projectiles = [];
    state.zombies = [];
    state.grid = {
      w: 30,
      h: 30,
      t: new Uint8Array(900).fill(1), // All walkable floor
      shapes: new Uint8Array(900).fill(0),
    } as any;
    state.player = {
      x: 10,
      z: 10,
      hp: 10,
      maxHp: 10,
      momSpeed: 0,
      momX: 0,
      momZ: 0,
      iframes: 0,
      flashT: 0,
      sprite: {
        mesh: new THREE.Object3D(),
        setTint: () => {},
      },
      anim: {} as any,
    } as unknown as Player;
    state.shakeT = 0;
  });

  afterEach(() => {
    state.scene = null;
    state.projectiles = [];
    state.zombies = [];
    state.player = null;
    state.grid = null;
  });

  it("configures Brute stats as a heavy ranged monster wielding dumbbells", () => {
    const s = STATS.brute;
    expect(s).toBeDefined();
    expect(s.ranged).toBe(true);
    expect(s.contactRange).toBe(BRUTE_THROW_RANGE);
    expect(s.bodyR).toBe(BRUTE_R);
  });

  it("executes melee double-dumbbell ground slam when player is in close quarters", () => {
    // Player is 1.0 unit away (<= 1.8 close-quarters threshold)
    state.player!.x = 11.0;
    state.player!.z = 10.0;

    const brute: Zombie = {
      kind: "brute",
      x: 10.0,
      z: 10.0,
      hp: BRUTE_HP,
      maxHp: BRUTE_HP,
      mode: "windup",
      speed: 1.2,
      windupT: STATS.brute.windup + 0.05, // Windup finished
      cooldown: 0,
      flashT: 0,
      burnT: 0,
      sprite: {
        mesh: new THREE.Object3D(),
        setFrame: () => {},
        setTint: () => {},
      } as any,
      anim: {
        set: () => {},
        update: () => {},
        setFacing: () => {},
        play: () => {},
      } as any,
      aggro: true,
    };
    state.zombies = [brute];

    updateZombies(0.016);

    // Should perform bruteSlam: damage player, high screen shake, NO thrown projectile
    expect(state.player!.hp).toBeLessThan(10);
    expect(state.shakeT).toBeGreaterThanOrEqual(0.3);
    expect(state.projectiles.length).toBe(0);
  });

  it("hurls a single heavy dumbbell projectile when player is at distance", () => {
    // Player is 3.5 units away (> 1.8 melee threshold, within BRUTE_THROW_RANGE)
    state.player!.x = 13.5;
    state.player!.z = 10.0;

    const brute: Zombie = {
      kind: "brute",
      x: 10.0,
      z: 10.0,
      hp: BRUTE_HP,
      maxHp: BRUTE_HP,
      mode: "windup",
      speed: 1.2,
      windupT: STATS.brute.windup + 0.05,
      cooldown: 0,
      flashT: 0,
      burnT: 0,
      sprite: {
        mesh: new THREE.Object3D(),
        setFrame: () => {},
        setTint: () => {},
      } as any,
      anim: {
        set: () => {},
        update: () => {},
        setFacing: () => {},
        play: () => {},
      } as any,
      aggro: true,
    };
    state.zombies = [brute];

    updateZombies(0.016);

    // Player should not be hit by melee slam directly
    expect(state.player!.hp).toBe(10);
    // Projectile should have been spawned aimed at the player (+X direction)
    expect(state.projectiles.length).toBe(1);
    const pr = state.projectiles[0];
    expect(pr.kind).toBe("dumbbell");
    expect(pr.damage).toBe(BRUTE_DUMBBELL_DAMAGE);
    expect(pr.vx).toBeGreaterThan(0);
  });

  it("hurls twin dumbbells in a V-spread when enraged below 40% HP", () => {
    // Player is 4.0 units away
    state.player!.x = 14.0;
    state.player!.z = 10.0;

    const brute: Zombie = {
      kind: "brute",
      x: 10.0,
      z: 10.0,
      hp: Math.floor(BRUTE_HP * 0.3), // 30% HP (below 40% enrage threshold)
      maxHp: BRUTE_HP,
      mode: "windup",
      speed: 1.2,
      windupT: STATS.brute.windup + 0.05,
      cooldown: 0,
      flashT: 0,
      burnT: 0,
      sprite: {
        mesh: new THREE.Object3D(),
        setFrame: () => {},
        setTint: () => {},
      } as any,
      anim: {
        set: () => {},
        update: () => {},
        setFacing: () => {},
        play: () => {},
      } as any,
      aggro: true,
    };
    state.zombies = [brute];

    updateZombies(0.016);

    // Enrage trigger should activate
    expect(brute.enraged).toBe(true);
    // Two dumbbells should be spawned (lead dumbbell + angled spread dumbbell)
    expect(state.projectiles.length).toBe(2);
    expect(state.projectiles[0].kind).toBe("dumbbell");
    expect(state.projectiles[1].kind).toBe("dumbbell");
    // The second dumbbell has angled trajectory (non-zero vz)
    expect(state.projectiles[1].vz).not.toBe(0);
  });
});
