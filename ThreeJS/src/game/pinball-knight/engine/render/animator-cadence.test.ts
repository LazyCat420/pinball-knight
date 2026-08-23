/**
 * CLIP CADENCE — pinned, so `beats` is provably a no-op where it is unused.
 *
 * A clip's duration is gameplay, not decoration: crouch is paced to END on
 * LEAP_WINDUP, wake on its burst window, and `entities/player.ts` gates logic on
 * `isFinished()`. So the mechanism that lets a clip gain in-betweens without
 * changing its duration needs a certificate, not an argument.
 *
 * ── THE PROBLEM `beats` SOLVES ──
 *
 * Adding frames does not resample. `Animator.update` steps at `1 / fps` with ONE
 * global fps per ClipName, and ENEMIES NEVER CALL setRate — only the player and
 * remote-party do. So taking a monster's walk from 4 frames to 8 at FPS_WALK 8
 * doubles its cycle from 0.5s to 1.0s while its world speed is unchanged: the
 * legs move at half cadence and the creature skates. `beats` divides the frame
 * count by the authored beat count, so more frames means smoother, never slower.
 */

import { describe, it, expect } from "vitest";
import { Animator } from "./animator";
import type { ClipName, Dir } from "./paint-types";
import type { SpriteSheet } from "./sprite";

/** A sheet with just enough shape for the animator; no canvas, no GPU. */
function fakeSprite(clip: ClipName, frames: number, beats?: number): {
  sheet: SpriteSheet; facing: Dir; setFrame: (i: number) => void; setFlipped: (f: boolean) => void;
} {
  const clips = new Map<string, number[]>();
  const indices = Array.from({ length: frames }, (_, i) => i);
  for (const dir of ["S", "N", "E"] as Dir[]) clips.set(`${dir}:${clip}`, indices);
  return {
    sheet: {
      texture: null as unknown as SpriteSheet["texture"],
      clips, frameCount: frames, cols: frames, rows: 1,
      ...(beats === undefined ? {} : { beats: { [clip]: beats } as Partial<Record<ClipName, number>> }),
    },
    facing: "E",
    setFrame: () => {},
    setFlipped: () => {},
  };
}

/** Seconds for a looping clip to return to frame 0, driven at 600Hz. */
function cycleSeconds(clip: ClipName, frames: number, beats?: number): number {
  const sprite = fakeSprite(clip, frames, beats);
  const anim = new Animator(sprite as never);
  anim.play(clip, { force: true });
  const dt = 1 / 600;
  let t = 0;
  let wrapped = false;
  let seen = 0;
  for (let i = 0; i < 600 * 20; i++) {
    anim.update(dt);
    t += dt;
    const idx = (anim as unknown as { frameIdx: number }).frameIdx;
    if (idx > seen) seen = idx;
    if (seen > 0 && idx === 0) { wrapped = true; break; }
  }
  expect(wrapped, `${clip} x${frames} never wrapped`).toBe(true);
  return t;
}

/**
 * Cycle duration per (clip, frame count) as shipped, in seconds.
 *
 * Written as the arithmetic (frames / fps) rather than as a decimal so a failure
 * names which side moved. The counts are the roster's real ones: walk is 8 on
 * the knight, 6 on the zombie, 4 on most monsters and 2 on pin/magnet/bat.
 */
const CYCLE: [ClipName, number, number][] = [
  ["walk", 8, 8 / 8],
  ["walk", 6, 6 / 8],
  ["walk", 4, 4 / 8],
  ["walk", 2, 2 / 8],
  ["idle", 2, 2 / 3],
  ["idle", 3, 3 / 3],
  ["run", 3, 3 / 10],
];

describe("clip cadence, as shipped", () => {
  for (const [clip, frames, expected] of CYCLE) {
    it(`${clip} x${frames} cycles in ${expected.toFixed(3)}s`, () => {
      expect(cycleSeconds(clip, frames)).toBeCloseTo(expected, 2);
    });
  }
});

describe("beats", () => {
  it("is inert when absent — the mechanism ships off", () => {
    expect(cycleSeconds("walk", 4)).toBeCloseTo(cycleSeconds("walk", 4, undefined), 3);
  });

  it("holds the cycle while the frame count doubles", () => {
    // THE POINT OF THE WHOLE MECHANISM. An 8-frame walk declaring 4 beats plays
    // in the same wall-clock time as the 4-frame original, so the creature's
    // feet keep up with its world speed and it gains smoothness instead of a
    // skate.
    const four = cycleSeconds("walk", 4);
    const eight = cycleSeconds("walk", 8, 4);
    expect(eight).toBeCloseTo(four, 2);
  });

  it("scales with the ratio, not with the raw count", () => {
    // 12 frames on a 4-beat clip is 3x the frames at 3x the rate.
    expect(cycleSeconds("walk", 12, 4)).toBeCloseTo(cycleSeconds("walk", 4), 2);
    // A clip declaring MORE beats than it has frames plays longer, which is the
    // honest reading of "authored as 8 beats, only 4 drawn".
    expect(cycleSeconds("walk", 4, 8)).toBeCloseTo(cycleSeconds("walk", 4) * 2, 2);
  });

  it("a repeated frame still costs a step — the impact-hold trick works", () => {
    // startSpriteSheet dedupes FramePaint by object reference but `clips` keeps
    // the duplicate index, so repeating a frame holds it for an extra step at
    // zero atlas cost. Pinned here against a future "optimisation" that dedupes
    // the index list and would silently delete every hold.
    expect(cycleSeconds("walk", 5)).toBeCloseTo(5 / 8, 2);
  });
});
