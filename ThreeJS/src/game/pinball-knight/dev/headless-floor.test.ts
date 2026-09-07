/**
 * THE HARNESS BUILDS THE FLOOR THE GAME BUILDS — checked, not asserted in prose.
 *
 * `dev/headless-floor.ts` carries a thirty-line header promising that
 * `buildHeadlessPlan` "mirrors `authorFloor` draw for draw". Nothing enforced
 * it, and it drifted twice, both times the same way — the SHIPPED path gained
 * an input to `decorateMaze` and the harness was not updated with it:
 *
 *   · `648e7c7e` (Plaza A-1a) taught `authorFloor` to hand the Great Hall
 *     plaza over as `rooms: track.chambers`. The harness kept passing `[]`.
 *   · `9b8cd369` added `doorways: track?.doorways`. The harness passed none.
 *
 * Neither is inert. `furnishRooms` DRAWS from the shared rng, so an empty room
 * list shifts every draw after it; `doorways` feeds `analyzePatternGrammar`,
 * whose clearway mask vetoes part candidates. The first drifts on greathall
 * floors (one depth in five), the second on every floor.
 *
 * WHAT IT COST. A census run through the drifted harness reported `plan.rooms`
 * = 0.0 and `orbit`-tagged parts = 0.0 at every depth, and the four-corner
 * ORBIT rail ring plus `shots.ts hitOrbitRail` were written up as dead code on
 * the strength of it. Both are alive on the shipped path. A harness that omits
 * an input reports a confident zero for everything that input feeds, and a zero
 * closes a question that a blank would have left open.
 *
 * ── Why this file compares rather than pins ───────────────────────────────
 *
 * The failure mode here is DIVERGENCE BETWEEN TWO CHAINS, so the assertion is
 * equality between them. Pinning "rooms >= 1 at L3" instead would transcribe a
 * constant that belongs to the generator and would fail the day someone
 * legitimately retunes `plazaFrac` — a test that goes red for having been
 * changed. Equality holds under any retune.
 *
 * The last case is the POSITIVE CONTROL. Without it a comparison of two chains
 * that both returned nothing, or that both ignored their seed, would pass while
 * measuring nothing at all.
 */
import { describe, expect, it } from "vitest";
import { authorFloor } from "../spawn/floor-authoring";
import { buildHeadlessPlan } from "./headless-floor";
import { state } from "../state";
import { archetypeFor } from "../maze/archetypes";

const SEEDS = [1, 424242];
// L3 and L8 are `greathall` — the one archetype with `plazaFrac > 0`, and
// therefore the only one whose `track.chambers` is ever non-empty. Derived from
// ARCHETYPES order, not transcribed: the guard below fails if that stops being
// true, rather than silently testing five floors that carve no room at all.
const LEVELS = [1, 3, 8];

interface Shot {
  rooms: string[];
  parts: string[];
  orbit: number;
  spawns: number;
  items: number;
}

const sig = (p: { i: number; j: number; kind: string }): string => `${p.i},${p.j},${p.kind}`;

function shipped(level: number, seed: number): Shot {
  state.runSeed = seed >>> 0;
  const { plan } = authorFloor(level);
  return snapshot(plan);
}

function harness(level: number, seed: number): Shot {
  const f = buildHeadlessPlan(level, seed);
  expect(f, `buildHeadlessPlan declined L${level} seed=${seed}`).not.toBeNull();
  return snapshot(f!.plan);
}

function snapshot(plan: ReturnType<typeof authorFloor>["plan"]): Shot {
  return {
    rooms: plan.rooms.map((r) => `${r.kind} ${r.w}x${r.h}@${r.i0},${r.j0}`).sort(),
    parts: plan.parts.map(sig).sort(),
    orbit: plan.parts.filter((p) => (p as { orbit?: number }).orbit !== undefined).length,
    spawns: plan.spawns.length,
    items: plan.items.length,
  };
}

describe("buildHeadlessPlan mirrors the floor the game ships", () => {
  it("at least one sampled depth carves a room, or this file proves nothing", () => {
    // The premise of every case below. `furnishRooms` on an empty list is a
    // no-op, so a sweep that never sees a room would compare two chains that
    // agree because neither did anything — green, and blind to the exact
    // regression this file exists to catch.
    const withPlaza = LEVELS.filter((l) => archetypeFor(l).track.plazaFrac > 0);
    expect(withPlaza.length, `no sampled depth has plazaFrac > 0 (sampled ${LEVELS.join(",")})`).toBeGreaterThan(0);
  });

  for (const level of LEVELS) {
    for (const seed of SEEDS) {
      it(`L${level} seed=${seed} (${archetypeFor(level).id}): same rooms, parts and orbit rails`, () => {
        const a = shipped(level, seed);
        const b = harness(level, seed);
        // Rooms first: this is the input that drifted, and naming it separately
        // means a failure says "the harness lost the plaza" rather than
        // "1,183 parts differ".
        expect(b.rooms, "rooms").toEqual(a.rooms);
        expect(b.orbit, "orbit-tagged rails").toBe(a.orbit);
        // …then everything downstream of the shared rng, which is what makes
        // an omitted input expensive rather than merely incomplete.
        expect(b.parts, "part positions").toEqual(a.parts);
        expect(b.spawns, "spawn count").toBe(a.spawns);
        expect(b.items, "item count").toBe(a.items);
      }, 120000);
    }
  }

  it("POSITIVE CONTROL: two different seeds do NOT agree", () => {
    // Sabotage for the assertions above. If `buildHeadlessPlan` ignored its
    // seed, or both chains returned empty plans, every case above would pass.
    // This is the same comparison run where it MUST fail.
    const a = harness(3, SEEDS[0]);
    const b = harness(3, SEEDS[1]);
    expect(a.parts).not.toEqual(b.parts);
  }, 120000);
});
