import { describe, it, expect, beforeEach } from "vitest";
import { Scene } from "three";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { state, resetState } from "../state";
import { damageZombie } from "./combat";
import { updateZombies } from "./zombie";
import { STAGGER_TINT } from "../constants/enemies";
import { makeSkinned } from "../spawn/factory";
import { sheetFor } from "../boot/sheets";

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

  it("damages goblin with low-momentum/standing attacks (rubber gate delivers 50% chip)", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0);
    state.zombies.push(g);

    const initialHp = g.hp;
    expect(initialHp).toBeGreaterThan(0);

    // Standing hit with 2 damage at 0 momentum
    damageZombie(g, 2, 0, 1, 1);

    // Should NOT be gated to 0 damage! 50% of 2 damage = 1 damage dealt
    expect(g.hp).toBe(initialHp - 1);
    expect(g.mode).toBeDefined();
  });

  it("kills goblin with repeated standing hits and plays death animation to completion", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0);
    state.zombies.push(g);

    // Deal lethal damage with repeated standing hits
    while (g.hp > 0) {
      damageZombie(g, 2, 0, 1, 1);
    }

    expect(g.hp).toBeLessThanOrEqual(0);
    expect(g.mode).toBe("dead");
    expect(g.anim.getClip()).toBe("death");
    expect(g.anim.getFrameIdx()).toBe(0);

    // Step physics & animation loop across 60 frames (~1 second)
    for (let f = 0; f < 60; f++) {
      updateZombies(0.016);
      g.anim.update(0.016);
    }

    // Must reach and hold the final death frame
    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);
  });

  it("recovers cleanly from stumble without remaining stuck in hurt pose or tint", () => {
    sheetFor("goblin");
    const g = makeSkinned("goblin", 1, 0);
    state.zombies.push(g);

    // Trigger stagger
    g.staggerT = 0.2;
    updateZombies(0.016);
    g.anim.update(0.016);

    expect(g.anim.getClip()).toBe("stumble");
    const matColor = (g.sprite.mesh.material as any).color.getHex();
    expect(matColor).toBe(STAGGER_TINT);

    // Run until stagger expires
    for (let f = 0; f < 20; f++) {
      updateZombies(0.016);
      g.anim.update(0.016);
    }

    expect(g.staggerT).toBe(0);
    expect(g.anim.getClip()).not.toBe("stumble");
    const recoveredColor = (g.sprite.mesh.material as any).color.getHex();
    expect(recoveredColor).toBe(0xffffff);
  });
});
