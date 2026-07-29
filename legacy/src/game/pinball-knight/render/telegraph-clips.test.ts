/**
 * THE TELEGRAPH CLIPS EXIST, AND THEIR ABSENCE IS SURVIVABLE.
 *
 * Two failure modes, both silent, both worth a test:
 *
 *  1. A clip is authored in cel-painter but never PACKED, because
 *     `buildSpriteSheet`'s clipNames list was not updated. The art renders
 *     nowhere and nothing throws.
 *
 *  2. A family does NOT author a clip, the animator resolves it to an empty
 *     index list, and `apply()` bails — so the actor freezes on whatever frame
 *     it was on. That is strictly worse than the tint-only telegraph this wave
 *     replaced, and it would only show on the families nobody checked.
 *
 * The fallback chain answers (2), and it is asserted here on the FRAME COUNTS
 * an unauthored clip actually resolves to, not on the presence of a table.
 */
import { describe, it, expect } from "vitest";
import { makeZombiePaints, makeSpiderPaints, makeMagnetPaints, makeGoblinPaints, makeBatPaints, withRecoil, ZOMBIE_VARIANTS } from "./cel-painter";
import type { ActorPaints, ClipName, Dir } from "../engine/render/paint-types";
import { Animator } from "../engine/render/animator";
import { readFileSync } from "fs";

const DIRS: Dir[] = ["S", "N", "E"];

function clipsOf(p: ActorPaints, clip: ClipName): number[] {
  return DIRS.map((d) => p[d][clip]?.length ?? 0);
}

describe("the four telegraph clips are authored where their policies run", () => {
  it("the zombie rig carries all four — it runs three of the six policies", () => {
    // Flailer → leaper (crouch), Midget → packhunter (wait), Crawler →
    // ambusher (wake), and every zombie/brute/boss/spitter staggers (stumble).
    const p = makeZombiePaints(ZOMBIE_VARIANTS[0]);
    for (const clip of ["crouch", "wait", "wake", "stumble"] as ClipName[]) {
      expect(clipsOf(p, clip), `zombie is missing ${clip}`).not.toContain(0);
    }
  });

  it("the crouch is a HELD pose, not a loop — it must end on its deepest frame", () => {
    // LEAP_WINDUP is 0.45s and the clip does not loop, so the last frame is
    // what the player stares at while deciding whether to move. It has to be
    // the most compressed one or the telegraph peaks early and then relaxes.
    const p = makeZombiePaints(ZOMBIE_VARIANTS[0]);
    expect(p.E.crouch!.length).toBeGreaterThanOrEqual(3);
  });

  it("the spider carries the crouch — the HOUND is a leaper on this sheet", () => {
    expect(clipsOf(makeSpiderPaints(), "crouch")).not.toContain(0);
  });

  it("the magnet carries the burst — the SAPPER is an ambusher on this sheet", () => {
    expect(clipsOf(makeMagnetPaints(), "wake")).not.toContain(0);
  });

  it("withRecoil gives every other family a stumble and a wake off its own idle", () => {
    // Stagger fires on a proportion of EVERY damage event, so "only the four
    // families I hand-posed react to being hit" is not a shippable answer.
    for (const [name, mk] of [["goblin", makeGoblinPaints], ["bat", makeBatPaints]] as const) {
      const bare = mk();
      expect(clipsOf(bare, "stumble"), `${name} unexpectedly hand-authors stumble`).toContain(0);
      const filled = withRecoil(bare);
      expect(clipsOf(filled, "stumble"), `${name} got no synthesized stumble`).not.toContain(0);
      expect(clipsOf(filled, "wake"), `${name} got no synthesized wake`).not.toContain(0);
    }
  });

  it("and NEVER overwrites art a family posed by hand", () => {
    const hand = makeSpiderPaints();
    const filled = withRecoil(hand);
    expect(filled.E.crouch).toBe(hand.E.crouch);
    expect(filled.E.stumble![0]).toBe(hand.E.stumble![0]);
  });

  it("a stumble frame is a different painter from the idle it came from", () => {
    // The synthesis is a transform, so a bug that returned the base frame
    // unchanged would still pass every count assertion above.
    const p = withRecoil(makeGoblinPaints());
    expect(p.E.stumble).not.toContain(p.E.idle![0]);
  });

  it("REGRESSION: buildSpriteSheet packs the new clips", () => {
    // A clip authored in cel-painter but absent from `buildSpriteSheet`'s
    // clipNames list is art that renders nowhere, and nothing throws.
    const src = readFileSync(new URL("../engine/render/sprite.ts", import.meta.url), "utf8");
    // Read the whole BRACKETED LIST, not the declaration's line. It used to
    // find the single line containing `const clipNames` and search that — which
    // silently became a no-op check the moment the list outgrew one line (the
    // six marble bodies did it), reporting "does not pack crouch" about a list
    // that packs it fine two lines down.
    // Anchor past the `=`, or the first `[` found is the one in the TYPE
    // annotation `ClipName[]` and the span is the empty string "[]" — the same
    // trap registry-drift.mjs documents for its ESSENTIAL and RESKIN reads.
    const from = src.indexOf("[", src.indexOf("=", src.indexOf("const clipNames")));
    const list = src.slice(from, src.indexOf("]", from) + 1);
    for (const clip of ["crouch", "wait", "wake", "stumble"]) {
      expect(list, `buildSpriteSheet does not pack "${clip}"`).toContain(`"${clip}"`);
    }
  });
});

/** The minimum an Animator actually touches — no three.js, no GL. */
function fakeSprite(clips: Record<string, number[]>): any {
  const frames: number[] = [];
  return {
    frames,
    sheet: { clips: new Map(Object.entries(clips)) },
    setFlipped() {},
    setFrame(i: number) {
      frames.push(i);
    },
  };
}

describe("an unauthored telegraph clip degrades, it does not freeze", () => {
  it("resolves to the clip the game played before it existed", () => {
    const sp = fakeSprite({ "S:idle": [0, 1], "S:walk": [2, 3, 4, 5] });
    const a = new Animator(sp);
    a.play("stumble");
    a.update(1); // a whole second — plenty for any rate
    expect(sp.frames.length, "the actor froze on an empty clip").toBeGreaterThan(1);
    expect(sp.frames.every((f: number) => f <= 1), "stumble resolved to something that is not idle").toBe(true);
  });

  it("inherits the RESOLVED clip's loop flag, so a fallback never holds mid-stride", () => {
    // `wake` is a one-shot; `walk` is a loop. Falling back to walk while keeping
    // wake's one-shot flag would freeze a bursting ambusher's legs halfway
    // through a stride for the rest of a 1.2s burst — not "unchanged", a new bug.
    const sp = fakeSprite({ "S:idle": [0, 1], "S:walk": [2, 3, 4, 5] });
    const a = new Animator(sp);
    a.play("wake");
    for (let i = 0; i < 120; i++) a.update(1 / 60);
    expect(a.isFinished(), "a walk fallback stopped looping").toBe(false);
  });

  it("but a family that DOES author the clip plays its own art", () => {
    const sp = fakeSprite({ "S:idle": [0, 1], "S:walk": [2, 3], "S:stumble": [7, 8, 9] });
    const a = new Animator(sp);
    a.play("stumble");
    a.update(1);
    expect(sp.frames.some((f: number) => f >= 7)).toBe(true);
    expect(a.isFinished(), "a one-shot stumble never ended").toBe(true);
  });
});
