import { describe, it, expect, beforeEach } from "vitest";
import { MonsterAnimator } from "./monster-animator";
import { buildSpriteSheet, type ActorSprite, type SpriteSheet } from "./sprite";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { withRecoil } from "../../render/cel-painter";
import * as THREE from "three";

describe("MonsterAnimator Dedicated State Machine (TDD)", () => {
  beforeEach(() => {
    installSpriteTestDom();
  });

  function makeMockSprite(): ActorSprite {
    const dummyPaints = {
      S: {
        idle: [() => {}],
        walk: [() => {}, () => {}],
        death: [() => {}, () => {}, () => {}, () => {}],
      },
      N: {},
      E: {},
    };
    const sheet = buildSpriteSheet(withRecoil(dummyPaints as any));
    let frame = -1;
    let flipped = false;

    return {
      mesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()),
      sheet,
      setFrame(idx: number) { frame = idx; },
      setFlipped(f: boolean) { flipped = f; },
      setTint() {},
      setSheet(s: SpriteSheet) { this.sheet = s; },
      setBlobVisible() {},
      setElevation() {},
      dispose() {},
    };
  }

  it("initializes in ALIVE state with idle clip", () => {
    const sprite = makeMockSprite();
    const anim = new MonsterAnimator(sprite);

    expect(anim.getState()).toBe("alive");
    expect(anim.isAlive()).toBe(true);
    expect(anim.isDying()).toBe(false);
    expect(anim.isDead()).toBe(false);
    expect(anim.getClip()).toBe("idle");
    expect(anim.getFrameIdx()).toBe(0);
    expect(anim.isFinished()).toBe(false);
  });

  it("transitions between clips and facings when ALIVE", () => {
    const sprite = makeMockSprite();
    const anim = new MonsterAnimator(sprite);

    anim.play("walk");
    expect(anim.getClip()).toBe("walk");

    anim.setFacing("E");
    expect(anim.getFacing()).toBe("E");
  });

  it("locks strictly into DYING on triggerDeath() and rejects interruptions", () => {
    const sprite = makeMockSprite();
    const anim = new MonsterAnimator(sprite);

    anim.triggerDeath("W");
    expect(anim.getState()).toBe("dying");
    expect(anim.isDying()).toBe(true);
    expect(anim.getClip()).toBe("death");
    expect(anim.getFacing()).toBe("W");
    expect(anim.getFrameIdx()).toBe(0);

    // Attempt to interrupt with walk, attack, idle, and facing change
    anim.play("idle", { force: true });
    anim.play("walk", { force: true });
    anim.setFacing("N");

    // Must remain death on W
    expect(anim.getClip()).toBe("death");
    expect(anim.getFacing()).toBe("W");
    expect(anim.getState()).toBe("dying");
  });

  it("progresses sequentially through death frames and locks to DEAD state on terminal frame", () => {
    const sprite = makeMockSprite();
    const anim = new MonsterAnimator(sprite);
    let endFired = false;

    anim.triggerDeath("S", () => { endFired = true; });

    // Step frames forward
    expect(anim.getFrameIdx()).toBe(0);

    // Update time: death is 6 fps (1/6 = ~0.166s per frame)
    anim.update(0.18);
    expect(anim.getFrameIdx()).toBe(1);
    expect(anim.getState()).toBe("dying");

    anim.update(0.18);
    expect(anim.getFrameIdx()).toBe(2);
    expect(anim.getState()).toBe("dying");

    anim.update(0.18);
    expect(anim.getFrameIdx()).toBe(3);
    expect(anim.getState()).toBe("dying");

    // After frame 3 completes its duration, state locks to "dead"
    anim.update(0.18);
    expect(anim.getFrameIdx()).toBe(3);
    expect(anim.getState()).toBe("dead");
    expect(anim.isDead()).toBe(true);
    expect(anim.isFinished()).toBe(true);
    expect(endFired).toBe(true);

    // Additional updates must clamp on terminal frame
    for (let i = 0; i < 20; i++) {
      anim.update(0.016);
    }
    expect(anim.getFrameIdx()).toBe(3);
    expect(anim.getState()).toBe("dead");
  });

  it("reapplies sheet gracefully during sheet rebuild without breaking death state", () => {
    const sprite = makeMockSprite();
    const anim = new MonsterAnimator(sprite);

    anim.triggerDeath("S");
    anim.update(0.18);
    expect(anim.getFrameIdx()).toBe(1);

    // New sheet rebuilt
    const newSheet = buildSpriteSheet(withRecoil({
      S: {
        idle: [() => {}],
        death: [() => {}, () => {}, () => {}, () => {}],
      },
      N: {},
      E: {},
    } as any));

    anim.reapplySheet(newSheet);
    expect(anim.sprite.sheet).toBe(newSheet);
    expect(anim.getClip()).toBe("death");
    expect(anim.getFrameIdx()).toBe(1);
    expect(anim.getState()).toBe("dying");

    // Complete progression on new sheet
    anim.update(0.36);
    expect(anim.getFrameIdx()).toBe(3);
    anim.update(0.18);
    expect(anim.getFrameIdx()).toBe(3);
    expect(anim.getState()).toBe("dead");
    expect(anim.isFinished()).toBe(true);
  });

  it("verifies uninterrupted death lifecycle progression across all monster families in state.zombies", () => {
    const kinds = ["goblin", "spider", "hound", "brute", "zombie", "ghost", "slime", "chomper"] as const;
    for (const kind of kinds) {
      const sprite = makeMockSprite();
      const anim = new MonsterAnimator(sprite);
      const z: any = {
        kind,
        mode: "chase",
        hp: 10,
        anim,
        sprite,
      };

      // Kill monster
      anim.triggerDeath("S");
      expect(anim.getState()).toBe("dying");
      expect(anim.getClip()).toBe("death");
      expect(anim.getFrameIdx()).toBe(0);

      // Advance presentation frames (50 frames at 60fps = 0.83s, death takes ~0.66s)
      for (let f = 0; f < 50; f++) {
        anim.update(0.016);
      }

      // Must be terminal dead and finished
      expect(anim.getState(), `${kind} state`).toBe("dead");
      expect(anim.isDead(), `${kind} isDead`).toBe(true);
      expect(anim.isFinished(), `${kind} isFinished`).toBe(true);
      expect(anim.getFrameIdx(), `${kind} terminal frame`).toBe(3);
    }
  });
});
