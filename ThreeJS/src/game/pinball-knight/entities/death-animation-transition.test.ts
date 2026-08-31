import { describe, it, expect, beforeEach } from "vitest";
import { state, freshPlayerFields } from "../state";
import { updateZombies } from "./zombie";
import { damageZombie, killZombie } from "./combat";
import { T_FLOOR } from "../maze/generator";
import type { Grid } from "../maze/generator";
import { FIXED_STEP } from "../constants";
import { Animator } from "../engine/render/animator";
import type { ActorSprite, SpriteSheet } from "../engine/render/sprite";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const W = 21;

function openGrid(): Grid {
  const t = new Uint8Array(W * W).fill(T_FLOOR);
  return { w: W, h: W, t, shapes: new Uint8Array(W * W) } as Grid;
}

function makeMockSpriteSheet(): SpriteSheet {
  const clips = new Map<string, number[]>();
  for (const dir of ["S", "N", "E"]) {
    clips.set(`${dir}:idle`, [0, 1]);
    clips.set(`${dir}:walk`, [2, 3]);
    clips.set(`${dir}:attack`, [4, 5]);
    clips.set(`${dir}:stumble`, [6, 7]);
    clips.set(`${dir}:death`, [8, 9, 10, 11]);
  }
  return {
    texture: {} as Any,
    clips,
    frameCount: 12,
    cols: 4,
    rows: 3,
  };
}

function makeTestZombie(kind: string = "goblin", hp: number = 20): Any {
  const sheet = makeMockSpriteSheet();
  let currentTint: number | null = null;
  let currentFrame = 0;
  const sprite: ActorSprite = {
    mesh: {
      position: { x: 5, y: 0, z: 5, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
      rotation: { z: 0 },
      material: { color: { setHex() {} } },
    } as Any,
    sheet,
    setFrame(idx: number) { currentFrame = idx; },
    setFlipped() {},
    setTint(hex: number | null) { currentTint = hex; },
    setSheet() {},
    setBlobVisible() {},
    setElevation() {},
  };
  const anim = new Animator(sprite);
  anim.setFacing("S");
  anim.play("idle");

  return {
    nid: "z1",
    kind,
    hp,
    maxHp: hp,
    mode: "chase",
    x: 5,
    z: 5,
    speed: 2,
    windupT: 0,
    cooldown: 0,
    dotT: 0, dotDmg: 0, dotTickT: 0, chillT: 0, flashT: 0, burnT: 0,
    aggro: true, staggerT: 0, painT: 0, knockT: 0, kbx: 0, kbz: 0,
    sprite,
    anim,
    getCurrentTint: () => currentTint,
    getCurrentFrame: () => currentFrame,
  };
}

describe("Hurt and Death animation transition logic", () => {
  beforeEach(() => {
    state.grid = openGrid();
    state.player = { x: 4, z: 4, ...freshPlayerFields() } as Any;
    state.zombies = [];
  });

  it("plays stumble upon non-lethal impact and transitions cleanly to death on fatal hit", () => {
    const z = makeTestZombie("goblin", 30);
    state.zombies.push(z);

    // 1. Deal non-lethal damage and trigger stagger
    damageZombie(z, 10, 1, 0, 0.5, 10);
    z.staggerT = 0.3;
    expect(z.hp).toBe(20);
    expect(z.mode).toBe("chase");

    // Update zombie simulation
    updateZombies(FIXED_STEP);
    expect(z.anim.getClip()).toBe("stumble");

    // 2. Deal fatal blow while staggered
    damageZombie(z, 25, 1, 0, 0.5, 10);
    expect(z.hp).toBeLessThanOrEqual(0);
    expect(z.mode).toBe("dead");
    expect(z.staggerT).toBe(0);
    expect(z.flashT).toBe(0);
    expect(z.anim.getClip()).toBe("death");
    expect(z.getCurrentTint()).toBeNull();

    // 3. Step through death animation frames
    // Death clip has 4 frames (8, 9, 10, 11) at 6 FPS (1 / 6 = 0.1667s per frame)
    expect(z.anim.isFinished()).toBe(false);
    z.anim.update(0.2); // frame 1 -> frame 2
    expect(z.anim.getClip()).toBe("death");
    z.anim.update(0.2); // frame 2 -> frame 3
    z.anim.update(0.4); // finishes and holds frame 4
    expect(z.anim.isFinished()).toBe(true);

    // 4. In dead mode, updateZombies does not reset clip or re-enter stagger
    updateZombies(FIXED_STEP);
    expect(z.mode).toBe("dead");
    expect(z.anim.getClip()).toBe("death");
  });

  it("killZombie clears tint and immediately resets anim to death frame 0", () => {
    const z = makeTestZombie("slime", 10);
    state.zombies.push(z);

    z.sprite.setTint(0xff0000);
    z.flashT = 0.5;
    z.staggerT = 0.5;
    z.anim.play("stumble");

    killZombie(z);

    expect(z.mode).toBe("dead");
    expect(z.flashT).toBe(0);
    expect(z.staggerT).toBe(0);
    expect(z.getCurrentTint()).toBeNull();
    expect(z.anim.getClip()).toBe("death");
  });
});
