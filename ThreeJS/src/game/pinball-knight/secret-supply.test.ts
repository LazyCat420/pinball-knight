/**
 * SECRET SUPPLY — do smashable bands actually EXIST on the floor that ships?
 *
 * ── The hole this closes ──────────────────────────────────────────────────
 *
 * `secret-doors.test.ts` proves the revolving door animates. `smashSecretAt`
 * has been covered for as long as it has existed. Both were green while the
 * mechanic was, in practice, unreachable: `crackSecretWalls` marks single tiles
 * on the HALF-SCALE grid on the understanding that `thickenWalls` will double
 * each into a 2×2 band, and the track-first generator does neither — it builds
 * at final resolution and DISCARDS that grid.
 *
 * Measured on the shipping path: `crackSecretWalls` picked 4-10 bands per floor,
 * the finished grid carried **zero**, and the only cracks a player ever met were
 * the incidental ones `openLaunchTargets` leaves while repairing launcher
 * runways — **3 bands across 25 consecutive floors in the running game**.
 *
 * Every existing test passed throughout. They were all asking "does the code
 * work", and the answer was yes; nothing was asking "does the floor contain any
 * of these", and the answer was no. That is the gap this file exists to hold,
 * and it is the same shape as the `FORWARD_FLOW_KINDS` miss recorded in
 * maze/floor-rules.ts: a rule is only real if something measures it on
 * generated floors.
 *
 * Floors are built through the SHIPPING path, because a supply claim about a
 * synthetic grid is not a claim about the game.
 */
import { describe, it, expect } from "vitest";
import { buildHeadlessPlan } from "./dev/headless-floor";
import { at, isWalkable, T_CRACKED } from "./maze/generator";
import { checkPieces, summarise } from "./maze/piece-rules";
import { pruneSealedBands } from "./secrets";

const SEEDS = [1, 12345, 0xc0ffee, 424242];
const LEVELS = [1, 2, 3, 5, 8, 12, 17, 25];

/** One floor, built exactly as `core.ts startLevel` builds it. */
function floor(level: number, seed: number) {
  const p = buildHeadlessPlan(level, seed);
  if (!p) return null;
  pruneSealedBands(p.grid, p.plan.secrets);
  return { g: p.grid, plan: p.plan, track: { mask: p.mask } };
}

describe("secret bands reach the floor the player stands on", () => {
  it("every floor ships smashable bands", () => {
    const counts: number[] = [];
    let floors = 0;
    for (const seed of SEEDS) {
      for (const level of LEVELS) {
        const f = floor(level, seed);
        if (!f) continue;
        floors++;
        counts.push(f.plan.secrets.length);
      }
    }
    const mean = counts.reduce((s, v) => s + v, 0) / Math.max(1, counts.length);
    const empty = counts.filter((n) => n === 0).length;
    console.log(`  secret bands: ${mean.toFixed(2)}/floor over ${floors} floors, ${empty} with none`);
    expect(floors).toBeGreaterThan(20);
    // THE ONE THAT WOULD HAVE CAUGHT IT. Before the supply pass this was 0.06.
    expect(mean, "the secret-wall mechanic has no supply on the shipping path").toBeGreaterThan(3);
    // A band is not guaranteed on a floor with no qualifying wall mass, but it
    // must stay the exception — measured at 1 floor in 32.
    expect(empty / floors, "most floors ship no secret at all").toBeLessThan(0.15);
  }, 300000);

  it("a band is four cracked tiles, even-aligned, and opens a real route", () => {
    // Each of these is load-bearing somewhere the band is CONSUMED, and each
    // would fail silently: `decorateMaze`'s secrets scan steps i/j by 2 so an
    // odd band is never seen; `build.ts` and `smashSecretAt` both read
    // s.i..s.i+1; and a cracked tile with no open neighbour is a smash that
    // opens a pocket rather than a shortcut.
    for (const seed of SEEDS.slice(0, 2)) {
      for (const level of LEVELS) {
        const f = floor(level, seed);
        if (!f) continue;
        for (const s of f.plan.secrets) {
          const label = `L${level} seed ${seed} band ${s.i},${s.j}`;
          expect(s.i % 2, `${label}: odd i — decorate's scan will never see it`).toBe(0);
          expect(s.j % 2, `${label}: odd j — decorate's scan will never see it`).toBe(0);
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            expect(at(f.g, s.i + di, s.j + dj), `${label}: tile ${di},${dj} is not cracked`).toBe(T_CRACKED);
          }
          const open = (i: number, j: number): boolean =>
            isWalkable(f.g, i + 1, j) || isWalkable(f.g, i - 1, j) || isWalkable(f.g, i, j + 1) || isWalkable(f.g, i, j - 1);
          for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
            expect(open(s.i + di, s.j + dj), `${label}: tile ${di},${dj} is sealed on all four sides`).toBe(true);
          }
        }
      }
    }
  }, 300000);

  it("stamping bands leaves the piece registry clean", () => {
    // The supply pass CUTS INTO finished wall geometry, so it is exactly the
    // kind of change that can leave a curved wall unbacked or a nub standing.
    // The first version of it did: cracking a band whose corridor touched only
    // one of its two faces produced 30 "sealed on all four sides" violations
    // across these same 32 floors.
    const bad: string[] = [];
    for (const seed of SEEDS) {
      for (const level of LEVELS) {
        const f = floor(level, seed);
        if (!f) continue;
        const v = checkPieces(f.g, f.track.mask).filter((x) => x.label !== "floor-sealed");
        if (v.length) bad.push(`L${level} seed ${seed}:\n${summarise(v)}`);
      }
    }
    expect(bad, `${bad.length} floors broke a piece rule:\n${bad.slice(0, 3).join("\n")}`).toEqual([]);
  }, 300000);
});
