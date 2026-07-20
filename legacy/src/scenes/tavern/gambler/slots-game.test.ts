/**
 * Slot machine CUE ORDER.
 *
 * The payout maths is pinned in `slots.test.ts`; this pins the other half — the
 * sequence of sounds, which is the only thing generating suspense given the
 * outcome is already decided before the first animation frame.
 *
 * The near-miss cue is the one worth a test. It has to fire when reel 2 lands
 * matching reel 1 AND reel 3 is still turning, read off the DECIDED outcome
 * rather than off whatever happens to be scrolling past. Both failure modes are
 * silent: cueing off the visible strip fires the riser on spins that were never
 * close, and firing it after the third reel has already landed resolves into
 * nothing. Neither throws, and neither is obvious by playing a few rounds.
 */
import { it, expect, vi, beforeEach } from "vitest";
import { createCanvas } from "canvas";

const calls: string[] = [];
vi.mock("./audio", () => ({
  sfxLeverPull: () => calls.push("lever"),
  sfxReelSpin: () => {
    calls.push("spin");
    return { stop: () => calls.push("spin-stop") };
  },
  sfxReelStop: (i: number) => calls.push(`stop${i}`),
  sfxNearMiss: () => calls.push("nearmiss"),
  sfxWinSmall: () => calls.push("win"),
  sfxJackpotJingle: () => calls.push("jackpot"),
  sfxLose: () => calls.push("lose"),
}));

const outcome = { reels: ["ball", "ball", "ball"], multiplier: 4, label: "THREE BALLS" };
vi.mock("./slots", async (orig) => ({ ...(await (orig() as any)), spin: () => outcome }));

beforeEach(() => {
  calls.length = 0;
});

async function run(reels: string[], multiplier: number) {
  (outcome as any).reels = reels;
  (outcome as any).multiplier = multiplier;
  const { createSlotsGame } = await import("./slots-game");
  const ctx: any = createCanvas(520, 200).getContext("2d");
  const g = createSlotsGame();
  g.play(10, { resolve: () => {}, raise: () => true });
  for (let e = 0; e < 2.4; e += 1 / 60) g.render(ctx, 520, 200, 1 / 60);
  return calls.slice();
}

it("near miss fires between the second and third stop", async () => {
  const c = await run(["ball", "ball", "skull"], 1.2);
  expect(c).toEqual(["lever", "spin", "stop0", "stop1", "nearmiss", "stop2", "spin-stop", "win"]);
});

it("no near miss when the first two differ", async () => {
  const c = await run(["ball", "skull", "target"], 0);
  expect(c).toEqual(["lever", "spin", "stop0", "stop1", "stop2", "spin-stop", "lose"]);
});

it("a jackpot triple gets the jingle, not the small win", async () => {
  const c = await run(["jackpot", "jackpot", "jackpot"], 25);
  expect(c).toContain("nearmiss");
  expect(c).toContain("jackpot");
  expect(c).not.toContain("win");
});
