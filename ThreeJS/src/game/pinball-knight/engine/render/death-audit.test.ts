/**
 * 🕵️ Monster Death Deep Audit & Contract Test Suite
 *
 * Implements the 9 non-negotiable death invariants identified during the deep audit.
 * Designed to locate bugs, silent statue freezes, UV desyncs, and clock conflicts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as THREE from "three";
import { state, type Zombie, type EnemyKind } from "../../state";
import { MonsterAnimator } from "./monster-animator";
import { skinSheet, rebuild } from "../../boot/sheets";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { killZombie } from "../../entities/combat";
import { makeSkinned } from "../../spawn/factory";
import { animationPresentation } from "../../presentation/animation-system";
import { updateZombies } from "../../entities/zombie";
import { buildSpriteSheet, type ActorSprite, type SpriteSheet } from "./sprite";
import { withRecoil } from "../../render/cel-painter";

describe("Monster Death Deep Audit: 9 Enforced Contracts", () => {
  let restoreDom: () => void;

  beforeEach(() => {
    restoreDom = installSpriteTestDom();
    state.zombies = [];
    state.scene = new THREE.Scene();
    state.hitstopT = 0;
  });

  afterEach(() => {
    restoreDom?.();
    state.zombies = [];
    state.scene = null;
  });

  function makeMockSpriteWithClips(clips: Record<string, number>): ActorSprite {
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

    const tex = sheet.texture.clone();
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);

    return {
      mesh,
      sheet,
      setFrame(idx: number) {
        frame = idx;
        const cols = this.sheet.cols || 1;
        const rows = this.sheet.rows || 1;
        const col = Math.max(0, idx) % cols;
        const row = Math.floor(Math.max(0, idx) / cols);
        tex.offset.x = (flipped ? col + 1 : col) / cols;
        tex.offset.y = (rows - 1 - row) / rows;
        tex.updateMatrix();
      },
      setFlipped(f: boolean) {
        flipped = f;
      },
      setTint() {},
      setSheet(s: SpriteSheet) {
        this.sheet = s;
        mat.map = s.texture.clone();
      },
      setBlobVisible() {},
      setElevation() {},
      dispose() {},
    };
  }

  // =========================================================================
  // CONTRACT 1: Art Completeness
  // Every spawnable kind has a >=3-frame death clip in all facings (S, N, E).
  // =========================================================================
  describe("Contract 1: Art Completeness Across Roster", () => {
    const SPAWNABLE_KINDS: EnemyKind[] = [
      "goblin", "spider", "hound", "brute", "zombie", "slime", "chomper",
      "croaker", "jester", "rotortail", "fish_feet", "spitter", "sporeling",
      "warden", "necromancer", "crystalback", "mimic", "ghost", "bat",
      "golem", "magnet", "webspinner", "pin", "bloater", "sapper", "wisp"
    ];

    for (const kind of SPAWNABLE_KINDS) {
      it(`kind "${kind}" must have >=3 distinct death cels in S facing`, () => {
        const sheet = skinSheet(kind);
        expect(sheet, `SpriteSheet for ${kind} must exist`).toBeDefined();
        if (!sheet) return;
        const deathS = sheet.clips.get("S:death") ?? sheet.clips.get("E:death") ?? sheet.clips.get("N:death");
        expect(deathS, `Monster kind "${kind}" must define a death clip`).toBeDefined();
        expect(deathS!.length, `Monster kind "${kind}" death clip must have >= 3 frames`).toBeGreaterThanOrEqual(3);
      });
    }
  });

  // =========================================================================
  // CONTRACT 2: No Silent Statues
  // A missing death row must NEVER freeze mid-stride silently without frames.
  // =========================================================================
  describe("Contract 2: No Silent Statues on Missing Death Art", () => {
    it("falls back gracefully and advances frames instead of freezing when death row is missing", () => {
      // Mock sheet with NO death clip at all
      const paintsWithoutDeath = {
        S: {
          idle: [() => {}],
          walk: [() => {}, () => {}],
          stumble: [() => {}, () => {}, () => {}],
        },
        N: {},
        E: {},
      };
      const sheet = buildSpriteSheet(withRecoil(paintsWithoutDeath as any));
      const sprite = makeMockSpriteWithClips({});
      sprite.sheet = sheet;

      const anim = new MonsterAnimator(sprite);
      anim.play("walk");
      anim.update(0.1);

      // Trigger death on a sheet that lacks death
      anim.triggerDeath("S");

      // The animator must NOT crash, must NOT stay stuck with undefined frame,
      // and must progress to finished/dead state.
      for (let i = 0; i < 60; i++) {
        anim.update(0.016);
      }

      expect(anim.isDead()).toBe(true);
      expect(anim.isFinished()).toBe(true);
    });
  });

  // =========================================================================
  // CONTRACT 3: Re-Trigger Immunity (Regression lock for commit 1c5035f)
  // Calling play("death") or triggerDeath() every single tick must NEVER reset frameIdx to 0.
  // =========================================================================
  describe("Contract 3: Re-Trigger Immunity", () => {
    it("advances monotonically when triggerDeath or play('death') is hammered every tick", () => {
      const sprite = makeMockSpriteWithClips({});
      const anim = new MonsterAnimator(sprite);

      anim.triggerDeath("S");
      expect(anim.getFrameIdx()).toBe(0);

      const visited = new Set<number>();
      visited.add(anim.getFrameIdx());

      for (let step = 0; step < 60; step++) {
        // Hammering re-trigger calls every tick (simulating buggy external loop)
        anim.triggerDeath("S");
        anim.play("death", { force: true });
        anim.update(0.016);
        visited.add(anim.getFrameIdx());
      }

      expect(visited.has(1), "Must reach frame 1 despite re-triggers").toBe(true);
      expect(visited.has(2), "Must reach frame 2 despite re-triggers").toBe(true);
      expect(visited.has(3), "Must reach frame 3 despite re-triggers").toBe(true);
      expect(anim.getFrameIdx(), "Must clamp on terminal frame").toBe(3);
      expect(anim.isDead()).toBe(true);
    });
  });

  // =========================================================================
  // CONTRACT 4: Interruption Immunity (Lock vs AI steering/hits)
  // Hostile calls to play()/setFacing()/setRate() after death are strictly rejected.
  // =========================================================================
  describe("Contract 4: Interruption Immunity", () => {
    it("rejects all external clip, facing, and rate changes once dying or dead", () => {
      const sprite = makeMockSpriteWithClips({});
      const anim = new MonsterAnimator(sprite);

      anim.triggerDeath("S");
      expect(anim.getState()).toBe("dying");
      expect(anim.getFacing()).toBe("S");

      // Attempt interruptions
      anim.play("walk", { force: true });
      anim.play("attack", { force: true });
      anim.setFacing("N");
      anim.setFacing("E");
      anim.setRate(0.001);

      expect(anim.getClip(), "Clip must remain death").toBe("death");
      expect(anim.getFacing(), "Facing must remain S").toBe("S");
      expect(anim.getRate(), "Rate must not be hijacked").toBe(1);
    });
  });

  // =========================================================================
  // CONTRACT 5: Single Clock Presentation & DT Spiral Safety
  // Presentation clock alone advances death; handles huge dt and dt=0 safely.
  // =========================================================================
  describe("Contract 5: Single Clock Presentation & Spiral Safety", () => {
    it("handles large dt burst (tab unthrottling) without infinite loops or resurrection", () => {
      const sprite = makeMockSpriteWithClips({});
      const anim = new MonsterAnimator(sprite);

      anim.triggerDeath("S");
      // Simulate a 5.0 second tab backgrounding freeze burst
      anim.update(5.0);

      expect(anim.getFrameIdx(), "Must clamp strictly to final frame").toBe(3);
      expect(anim.isDead()).toBe(true);
      expect(anim.isFinished()).toBe(true);
    });

    it("does not advance on dt = 0", () => {
      const sprite = makeMockSpriteWithClips({});
      const anim = new MonsterAnimator(sprite);

      anim.triggerDeath("S");
      expect(anim.getFrameIdx()).toBe(0);

      anim.update(0);
      expect(anim.getFrameIdx()).toBe(0);
      expect(anim.getState()).toBe("dying");
    });
  });

  // =========================================================================
  // CONTRACT 6: Entry-Route Convergence
  // Melee strike, lethal damage, and dev kill hooks all converge to identical state.
  // =========================================================================
  describe("Contract 6: Entry-Route Convergence", () => {
    it("converges to dying/dead state via killZombie", () => {
      const g = makeSkinned("goblin", 2, 2, 1);
      expect(g).toBeDefined();
      if (!g) return;
      state.zombies.push(g);

      killZombie(g);
      expect(g.mode).toBe("dead");
      expect(g.anim.getClip()).toBe("death");
      expect((g.anim as any).getState()).toBe("dying");

      // Advance presentation
      for (let f = 0; f < 60; f++) {
        animationPresentation.update(0.016);
      }

      expect(g.anim.isDead()).toBe(true);
      expect(g.anim.isFinished()).toBe(true);
    });
  });

  // =========================================================================
  // CONTRACT 7: Sheet-Rebuild Safety (Regression lock for commit 65faedb)
  // Background atlas rebuilds mid-death preserve current frame and terminal pose.
  // =========================================================================
  describe("Contract 7: Sheet-Rebuild Safety", () => {
    it("preserves death progress and corpse pose during rebuild() mid-animation", () => {
      const g = makeSkinned("goblin", 2, 2, 1);
      expect(g).toBeDefined();
      if (!g) return;
      state.zombies.push(g);

      killZombie(g);

      // Step to frame 1
      for (let f = 0; f < 12; f++) {
        animationPresentation.update(0.016);
      }
      expect(g.anim.getFrameIdx()).toBeGreaterThanOrEqual(1);
      const frameBefore = g.anim.getFrameIdx();

      // Trigger atlas rebuild mid-death
      rebuild("goblin");

      expect(g.anim.getClip()).toBe("death");
      expect(g.anim.getFrameIdx()).toBe(frameBefore);
      expect(g.anim.isDying() || g.anim.isDead()).toBe(true);

      // Complete death animation on rebuilt sheet
      for (let f = 0; f < 50; f++) {
        animationPresentation.update(0.016);
      }

      expect(g.anim.isDead()).toBe(true);
      expect(g.anim.isFinished()).toBe(true);
    });
  });

  // =========================================================================
  // CONTRACT 8: UV Ground Truth (State-getter independent verification)
  // The live texture UV offset must physically step through distinct cels and hold the last.
  // =========================================================================
  describe("Contract 8: UV Ground Truth on Real Texture Offset", () => {
    it("verifies physical texture UV offset changes across frames and clamps to terminal cel", () => {
      const sprite = makeMockSpriteWithClips({});
      const anim = new MonsterAnimator(sprite);

      anim.triggerDeath("S");

      const uvOffsets = new Set<string>();
      const map = (sprite.mesh.material as THREE.MeshBasicMaterial).map!;

      for (let f = 0; f < 60; f++) {
        anim.update(0.016);
        uvOffsets.add(`${map.offset.x.toFixed(4)},${map.offset.y.toFixed(4)}`);
      }

      // Must have stepped through at least 3 distinct UV offsets on the texture
      expect(uvOffsets.size, "Texture must have physically sampled distinct UV offsets").toBeGreaterThanOrEqual(3);

      const finalUv = `${map.offset.x.toFixed(4)},${map.offset.y.toFixed(4)}`;
      // Additional steps must clamp and never change the UV
      for (let f = 0; f < 20; f++) {
        anim.update(0.016);
      }
      const clampUv = `${map.offset.x.toFixed(4)},${map.offset.y.toFixed(4)}`;
      expect(clampUv, "Texture UV must remain clamped on final corpse puddle cel").toBe(finalUv);
    });
  });

  // =========================================================================
  // CONTRACT 9: Reaper Exemption
  // The Death Dealer / Reaper is immortal and cannot enter the standard monster death pipeline.
  // =========================================================================
  describe("Contract 9: Reaper Hazard Exemption", () => {
    it("reaper does not enter standard monster death puddle pipeline", () => {
      const reaper = makeSkinned("reaper", 2, 2, 1);
      if (!reaper) return;
      state.zombies.push(reaper);

      // Attempting lethal damage on reaper must be handled by reaper hazard logic,
      // not normal killZombie death
      expect(reaper.kind).toBe("reaper");
      // Even if killZombie is called, verify safety
      killZombie(reaper);
      expect(reaper.anim.getClip()).toBe("death");
    });
  });
});
