/**
 * A one-shot clip must not be told to loop, or to stay put.
 *
 * The bug this pins shipped and was found by eye: every animate prompt ended
 * with "smooth looping animation, the character stays centered in frame",
 * including `attack`. Both clauses contradict a lunge — one says return to
 * your start pose, the other says do not travel — so the model animated the
 * only part of a bite that violates neither, the jaw. The report was "the
 * hound looks like it's just showing its teeth"; the measurement was 11.3%
 * churn against the walk's 22.1%.
 *
 * The assertions are about DISCRIMINATION. A test that only checked "the walk
 * prompt contains 'looping'" would have passed before the fix as well as
 * after, which is the shape of check this repo has already been burned by.
 */
import { describe, expect, it } from "vitest";
import { MODES } from "./comfy/modes.mjs";

const animate = MODES.find((m: { id: string }) => m.id === "animate")!;
const ctx = {
  has: () => true, lora: () => "x", unet: () => null, chosen: () => null,
  fileOf: () => "x", fast: false, small: false, images: { init: {} }, seed: 7,
};
const promptFor = (preset: string) =>
  animate.prompt({ preset, action: "", frames: "21" }, ctx) as string;

/** clip -> a preset that targets it, quadruped where one exists. */
const CYCLES = ["idle4", "walk4", "run4"];
const ONE_SHOTS = ["attack4", "stumble4", "defend4", "death4"];

describe("the animate prompt tail", () => {
  it("tells a cycle to loop", () => {
    for (const p of CYCLES) {
      expect(promptFor(p), p).toContain("smooth looping animation");
      expect(promptFor(p), p).toContain("stays centered in frame");
    }
  });

  it("does NOT tell a one-shot to loop or to stay put", () => {
    // The exact defect. Both clauses, both absent, on every one-shot.
    for (const p of ONE_SHOTS) {
      expect(promptFor(p), p).not.toContain("looping");
      expect(promptFor(p), p).not.toContain("stays centered in frame");
    }
  });

  it("tells a one-shot to end somewhere else", () => {
    for (const p of ONE_SHOTS) {
      expect(promptFor(p), p).toContain("clearly different pose");
    }
  });

  it("keeps the figure renderable — a one-shot still pins the CAMERA", () => {
    /**
     * The first version of this fix freed the pose and forbade nothing about
     * size, and the model spent the freedom on the cheapest motion it has:
     * it shrank the dog. Measured on the S attack, one variable, seed 7 —
     * churn 11.1% -> 28.3%, silhouettes 20 -> 21, and frame 20 was barely
     * more than a head. A receding figure churns pixels beautifully and is
     * useless as a sprite: drift.ts registers cells by bounding box, so a
     * figure that halves is a different sprite rather than a pose.
     *
     * Note the negative CANNOT be relied on here — Wan's shared negative
     * already bans "changing scale, character growing, character shrinking"
     * and the dog shrank regardless. The positive clause is the lever.
     */
    for (const p of ONE_SHOTS) {
      expect(promptFor(p), p).toContain("locked-off camera");
      expect(promptFor(p), p).toContain("inside the frame");
    }
  });

  it("the two tails are actually different", () => {
    // If a refactor ever collapses them back into one string, every assertion
    // above could still pass individually while the distinction is gone.
    const cycle = promptFor("walk4");
    const shot = promptFor("attack4");
    expect(cycle.slice(cycle.indexOf(", smooth"))).not.toBe(shot.slice(shot.indexOf(", one continuous")));
  });
});

describe("attack4 asks for a lunge, not a snarl", () => {
  it("names anticipation, strike and recovery as separate beats", () => {
    const p = promptFor("attack4");
    expect(p).toMatch(/coiling back/);      // anticipation
    expect(p).toMatch(/exploding forward/); // strike
    expect(p).toMatch(/landing heavily/);   // follow-through
  });

  it("bans the observed failure, a stationary snarl", () => {
    const preset = (animate.presets as { id: string; avoid?: string }[]).find((x) => x.id === "attack4")!;
    expect(preset.avoid).toContain("snarling in place");
    expect(preset.avoid).toContain("only the jaw moving");
  });
});
