/**
 * 🔬 DIAGNOSTIC TEST — traces the REAL death pipeline end-to-end.
 *
 * Unlike death-audit.test.ts which uses fake sheets with known clip data,
 * this test builds the ACTUAL sprite sheets from the REAL painter/imported
 * art pipeline and observes what happens when a monster dies.
 *
 * This is the test that would have caught a false positive in the prior suite.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state, type Zombie, type EnemyKind } from "../../state";
import { MonsterAnimator } from "./monster-animator";
import { createActorSprite, buildSpriteSheet, type SpriteSheet } from "./sprite";
import { animationPresentation } from "../../presentation/animation-system";
import { killZombie } from "../../entities/combat";
import { makeZombiePaints, ZOMBIE_VARIANTS } from "../../render/cel-painter";
import { SHEET_PAINTERS } from "../../render/sheet-painters";
import { installSpriteTestDom } from "../../testkit/atlas-census";

// Kinds that use SHEET_PAINTERS (procedural art) — these are the ones
// that always have a painter-generated death clip.
const PROCEDURAL_KINDS: EnemyKind[] = [
  "zombie", "spider", "brute", "spitter", "ghost", "bat", "slime",
  "goblin", "chomper", "golem", "jester", "croaker", "magnet",
  "webspinner", "sporeling", "rotortail", "stiltneck", "fish_feet",
];

function makeTestSheet(kind: EnemyKind): SpriteSheet {
  if (kind === "zombie") {
    return buildSpriteSheet(makeZombiePaints(ZOMBIE_VARIANTS[0]));
  }
  const builder = (SHEET_PAINTERS as any)[kind];
  if (builder) {
    return buildSpriteSheet(builder());
  }
  throw new Error(`No painter for ${kind}`);
}

function fakeZombie(kind: EnemyKind, sheet: SpriteSheet): Zombie {
  const sprite = createActorSprite(sheet, false);
  const anim = new MonsterAnimator(sprite);
  anim.setFacing("S");
  anim.play("idle");
  return {
    nid: `test-${kind}`,
    dbgId: `${kind}#test`,
    sprite,
    anim,
    x: 0,
    z: 0,
    kind,
    hp: 1,
    mode: "idle",
    speed: 1,
    windupT: 0,
    cooldown: 0,
    flashT: 0,
    aggro: false,
    burnT: 0,
    bobT: 0,
    movePhase: 0,
    staggerT: 0,
  } as any as Zombie;
}

describe("death-pipeline-diagnostic: REAL sheet end-to-end", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    restore = installSpriteTestDom();
    state.zombies = [];
    state.sheets = {} as any;
    state.zombieVariantSheets = [];
    state.scene = null as any;
    state.player = null as any;
    state.grid = null as any;
  });

  afterEach(() => {
    restore?.();
    restore = null;
  });

  for (const kind of PROCEDURAL_KINDS) {
    describe(`${kind}`, () => {
      it("has death clip indices in the REAL sheet that differ from idle indices", () => {
        const sheet = makeTestSheet(kind);
        const clips = sheet.clips;

        // Find the death clip indices
        const deathKey = Array.from(clips.keys()).find(k => k.endsWith(":death"));
        const idleKey = Array.from(clips.keys()).find(k => k.endsWith(":idle"));

        // CRITICAL: does the sheet even HAVE a death clip?
        expect(deathKey, `${kind} sheet must have a death clip`).toBeTruthy();
        const deathIndices = clips.get(deathKey!)!;
        expect(deathIndices.length, `${kind} death clip must have frames`).toBeGreaterThan(0);

        // Do the death indices differ from idle indices?
        if (idleKey) {
          const idleIndices = clips.get(idleKey!)!;
          const overlap = deathIndices.filter(d => idleIndices.includes(d));
          // Some overlap is possible (shared frames), but FULL overlap means death looks identical to idle
          expect(
            overlap.length < deathIndices.length,
            `${kind}: ALL death frames (${deathIndices}) overlap with idle frames (${idleIndices}) — death animation would look identical to idle!`
          ).toBe(true);
        }
      });

      it("advances through distinct frames during death animation", () => {
        const sheet = makeTestSheet(kind);
        const z = fakeZombie(kind, sheet);
        state.zombies = [z];

        // Kill the zombie
        z.hp = 0;
        z.mode = "dead";
        z.anim.triggerDeath(z.anim.getFacing());

        // Verify state transition
        expect(z.anim.getState(), `${kind} should be dying after triggerDeath`).toBe("dying");
        expect(z.anim.getClip(), `${kind} should be on death clip`).toBe("death");

        // Record frames seen during animation
        const framesSeen = new Set<number>();
        framesSeen.add(z.anim.getFrameIdx());

        // Step through 120 frames at 60fps (2 seconds)
        for (let i = 0; i < 120; i++) {
          animationPresentation.update(1 / 60);
          framesSeen.add(z.anim.getFrameIdx());
        }

        // After 2 seconds at 60fps, the animation MUST have finished
        expect(z.anim.isFinished(), `${kind} death should be finished after 2s`).toBe(true);
        expect(z.anim.getState(), `${kind} should be dead after animation completes`).toBe("dead");

        // CRITICAL CHECK: did more than 1 frame get rendered?
        const deathIndices = sheet.clips.get(`S:death`) ?? sheet.clips.get(`E:death`) ?? sheet.clips.get(`N:death`);
        if (deathIndices && deathIndices.length > 1) {
          expect(
            framesSeen.size,
            `${kind}: only ${framesSeen.size} frame(s) seen during death (${[...framesSeen]}), but death has ${deathIndices.length} frames. Animation may be completing too fast or not advancing.`
          ).toBeGreaterThan(1);
        }

        console.log(`  ${kind}: death=[${deathIndices?.join(",")}] framesSeen=[${[...framesSeen]}] finished=${z.anim.isFinished()}`);
      });

      it("killZombie() triggers MonsterAnimator.triggerDeath (not Animator.play)", () => {
        const sheet = makeTestSheet(kind);
        const z = fakeZombie(kind, sheet);
        state.zombies = [z];
        state.grid = {} as any; // killZombie needs grid

        // Spy on triggerDeath
        let triggerDeathCalled = false;
        const origTriggerDeath = z.anim.triggerDeath.bind(z.anim);
        (z.anim as any).triggerDeath = (...args: any[]) => {
          triggerDeathCalled = true;
          return origTriggerDeath(...args);
        };

        // Kill via killZombie
        z.hp = 0;
        killZombie(z);

        expect(triggerDeathCalled, `${kind}: killZombie must call triggerDeath, not play("death")`).toBe(true);
        expect(z.mode).toBe("dead");
        expect(z.anim.getState()).toMatch(/dying|dead/);
        expect(z.anim.getClip()).toBe("death");
      });
    });
  }

  it("ATLAS CENSUS: report all clip indices for goblin (diagnostic)", () => {
    const sheet = makeTestSheet("goblin");
    console.log("\n  GOBLIN ATLAS CENSUS:");
    console.log(`    cols=${sheet.cols} rows=${sheet.rows} frameCount=${sheet.frameCount}`);
    for (const [key, indices] of sheet.clips) {
      console.log(`    ${key}: [${indices.join(", ")}]`);
    }

    // Cross-check: death indices must not be a subset of any alive clip
    const deathKey = Array.from(sheet.clips.keys()).find(k => k.endsWith(":death"));
    if (deathKey) {
      const deathIndices = sheet.clips.get(deathKey)!;
      const aliveKeys = Array.from(sheet.clips.keys()).filter(k => !k.endsWith(":death"));
      for (const ak of aliveKeys) {
        const aliveIndices = sheet.clips.get(ak)!;
        const fullyContained = deathIndices.every(d => aliveIndices.includes(d));
        if (fullyContained && deathIndices.length > 0) {
          console.error(`    DEATH indices fully contained in ${ak}!`);
        }
      }
    }
    expect(true).toBe(true); // diagnostic only
  });
});
