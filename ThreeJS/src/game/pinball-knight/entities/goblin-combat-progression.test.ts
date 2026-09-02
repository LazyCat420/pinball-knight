import { describe, it, expect, beforeEach } from "vitest";
import { state } from "../state";
import { damageZombie, syncActorMesh } from "./combat";
import { updateZombies } from "./zombie";
import { buildSpriteSheet } from "./sprite";
import { BUILDERS } from "../boot/sheets";
import { Animator } from "../engine/render/animator";

function makeTestGoblin() {
  const paints = BUILDERS.goblin();
  const sheet = buildSpriteSheet(paints);
  const anim = new Animator(sheet, "S");
  const mesh = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { y: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    material: {
      map: {
        offset: { x: 0, y: 0 },
        repeat: { x: 1 / sheet.cols, y: 1 / sheet.rows },
      },
    },
  };
  const sprite = {
    mesh: mesh as any,
    sheet,
    tint: null as number | null,
    setTint: (t: number | null) => { sprite.tint = t; },
    setSheet: (s: any) => { sprite.sheet = s; },
  };
  return {
    kind: "goblin" as const,
    mode: "chase" as const,
    x: 0,
    z: 0,
    hp: 4,
    maxHp: 4,
    vx: 0,
    vz: 0,
    facing: "S" as const,
    flashT: 0,
    cooldown: 0,
    windupT: 0,
    staggerT: 0,
    anim,
    sprite: sprite as any,
  };
}

describe("Goblin Combat Progression & Animation Verification", () => {
  beforeEach(() => {
    state.zombies = [];
    state.vfx = { sparks: () => {} } as any;
    state.player = {
      x: 0,
      z: 0,
      momSpeed: 0, // Standing still / walking pace
      hp: 10,
    } as any;
    state.grid = {} as any;
  });

  it("damages goblin with low-momentum/standing attacks (rubber gate delivers 50% chip)", () => {
    const g = makeTestGoblin();
    state.zombies.push(g as any);

    // Initial HP
    expect(g.hp).toBe(4);

    // Standing hit with 2 damage at 0 momentum
    damageZombie(g as any, 2, 0, 1, 1);

    // Should NOT be gated to 0 damage! 50% of 2 damage = 1 damage dealt
    expect(g.hp).toBe(3);
    expect(g.mode).toBe("chase");
  });

  it("kills goblin with repeated standing hits and plays death animation to completion", () => {
    const g = makeTestGoblin();
    state.zombies.push(g as any);

    // 4 hits of 2 damage (each deals 1 damage) reduces HP 4 -> 0
    damageZombie(g as any, 2, 0, 1, 1);
    damageZombie(g as any, 2, 0, 1, 1);
    damageZombie(g as any, 2, 0, 1, 1);
    damageZombie(g as any, 2, 0, 1, 1);

    expect(g.hp).toBe(0);
    expect(g.mode).toBe("dead");
    expect(g.anim.getClip()).toBe("death");
    expect(g.anim.getFrameIdx()).toBe(0);

    // Step physics & animation loop across 60 frames (~1 second)
    for (let f = 0; f < 60; f++) {
      updateZombies(0.016);
    }

    // Must reach and hold the final death frame
    expect(g.anim.getFrameIdx()).toBe(3);
    expect(g.anim.isFinished()).toBe(true);
  });

  it("recovers cleanly from stumble without remaining stuck in hurt pose or tint", () => {
    const g = makeTestGoblin();
    state.zombies.push(g as any);

    // Trigger stagger
    g.staggerT = 0.2;
    updateZombies(0.016);

    expect(g.anim.getClip()).toBe("stumble");
    expect(g.sprite.tint).not.toBeNull();

    // Run until stagger expires
    for (let f = 0; f < 20; f++) {
      updateZombies(0.016);
    }

    expect(g.staggerT).toBe(0);
    expect(g.anim.getClip()).not.toBe("stumble");
    expect(g.sprite.tint).toBeNull();
  });
});
