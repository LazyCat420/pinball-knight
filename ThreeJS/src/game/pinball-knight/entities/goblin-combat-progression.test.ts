import { describe, it, expect, beforeEach } from "vitest";
import { Scene } from "three";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { state, resetState } from "../state";
import { damageZombie } from "./combat";
import { updateZombies } from "./zombie";
import { STAGGER_TINT } from "../constants/enemies";
import { makeSkinned } from "../spawn/factory";
import { sheetFor } from "../boot/sheets";
import { MOMENTUM_T_FLOOR } from "../constants";
import { animationPresentation } from "../presentation/animation-system";

describe("Goblin Combat Progression & Animation Verification", () => {
  beforeEach(() => {
    installSpriteTestDom();
    resetState();
    state.scene = new Scene();
    state.zombies = [];
    state.vfx = new Proxy({}, { get: () => () => {} }) as any;
    state.player = {
      x: 0,
      z: 0,
      momSpeed: 0, // Standing still / walking pace
      hp: 10,
      anim: { update: () => {} } as any,
    } as any;
    state.grid = { w: 20, h: 20, t: new Uint8Array(400).fill(1), shapes: new Uint8Array(400) } as any;
  });

  it("damages goblin with stationary melee attacks at 0 momentum", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0, 1)!;
    state.zombies.push(g);

    const initialHp = g.hp;
    expect(initialHp).toBe(2);

    // Standing hit with 1 damage at 0 momentum lands and reduces HP
    damageZombie(g, 1, 0, 1, 1);
    expect(g.hp).toBe(1);

    // Second hit kills the goblin
    damageZombie(g, 1, 0, 1, 1);
    expect(g.hp).toBe(0);
    expect(g.mode).toBe("dead");
    expect(g.corpseT).toBe(0);
    expect((g.sprite as any).blob?.visible ?? false).toBe(false);
  });

  it("kills goblin with momentum hits and plays death animation to completion", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0, 1)!;
    state.zombies.push(g);

    // Attack carried at pinball speed
    state.player!.momSpeed = MOMENTUM_T_FLOOR + 5;

    while (g.hp > 0) {
      damageZombie(g, 10, 0, 1, 1);
    }

    expect(g.hp).toBeLessThanOrEqual(0);
    expect(g.mode).toBe("dead");
    expect(g.anim.getClip()).toBe("death");
    expect(g.anim.getFrameIdx()).toBe(0);

    // Step physics & animation loop across 60 frames (~1 second)
    for (let f = 0; f < 60; f++) {
      updateZombies(0.016);
      animationPresentation.update(0.016);
    }

    // Must reach and hold the final death frame
    expect(g!.anim.getFrameIdx()).toBe(3);
    expect(g!.anim.isFinished()).toBe(true);
  });

  it("recovers cleanly from stumble without remaining stuck in hurt pose or tint", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0, 1)!;
    state.zombies.push(g);

    // Trigger stagger
    g.staggerT = 0.2;
    updateZombies(0.016);
    animationPresentation.update(0.016);

    expect(g.anim.getClip()).toBe("stumble");
    const matColor = (g.sprite.mesh.material as any).color.getHex();
    expect(matColor).toBe(STAGGER_TINT);

    // Run until stagger expires
    for (let f = 0; f < 20; f++) {
      updateZombies(0.016);
      animationPresentation.update(0.016);
    }

    expect(g.staggerT).toBe(0);
    expect(g.anim.getClip()).not.toBe("stumble");
    const recoveredColor = (g.sprite.mesh.material as any).color.getHex();
    expect(recoveredColor).toBe(0xffffff);
  });

  it("damages and kills goblin through bumper collision in updateZombies", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 0.4, 0, 1)!;
    state.zombies.push(g);
    expect(g.hp).toBe(2);

    // Collision 1 deals 1 damage and pops player away
    updateZombies(0.016);
    expect(g.hp).toBe(1);
    expect(state.player!.momSpeed).toBeGreaterThan(0);

    // Reset cooldown and collide again to deliver lethal blow
    g.cooldown = 0;
    state.player!.x = 0;
    state.player!.z = 0;
    g.x = 0.4;
    g.z = 0;
    updateZombies(0.016);
    expect(g.hp).toBe(0);
    expect(g.mode).toBe("dead");

    // Advance animation presentation to ensure full death playback
    for (let f = 0; f < 60; f++) {
      animationPresentation.update(0.016);
    }
    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);
  });

  it("connects active melee attack during bumper contact and kills goblin", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 0.5, 0, 1)!;
    state.zombies.push(g);
    expect(g.hp).toBe(2);

    // Player swinging facing East towards the goblin
    state.player!.facing = "E";
    state.player!.attackT = 0.05;
    state.player!.didHit = false;

    updateZombies(0.016);
    expect(state.player!.didHit).toBe(true);
    expect(g.hp).toBeLessThan(2);
  });
});

