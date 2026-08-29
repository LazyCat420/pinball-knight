/**
 * THE DENSITY GATE — every shipping floor carries a legible amount of stuff.
 *
 * The gate that did not exist when live QA reported floor 5 as "a jumbled mess".
 * `floor-metrics.test.ts` judges the floor's SHAPE and would have passed it
 * without complaint; this one judges how much is standing on it.
 *
 * Runs the real pipeline — `buildTrackFloor` + `decorateMaze` with core.ts's own
 * extras — because the numbers only mean anything on the floor that ships.
 */
import { describe, it, expect } from "vitest";
import { mulberry32, isWalkable } from "./generator";
import { ARCHETYPES } from "./archetypes";
import { measureDensity, checkDensity, formatDensity, DEFAULT_DENSITY } from "./floor-density";
import { liveFloor } from "../testkit/live-floor";

describe("floor density", () => {
  it("every archetype at every depth stays inside the legibility bands", () => {
    const bad: string[] = [];
    let floors = 0;
    for (let a = 0; a < ARCHETYPES.length; a++) {
      for (const level of [1, 3, 6, 10, 14, 20]) {
        for (let s = 0; s < 2; s++) {
          const seed = 0x2f11 + s * 6113 + level * 271 + a * 3313;
          const f = liveFloor(level, seed, a);
          if (!f) continue;
          floors++;
          const m = measureDensity(f.plan, f.walkable);
          const v = checkDensity(m);
          if (v.length) bad.push(`L${level} ${f.arch.id} seed=${seed}: ${v.join("; ")}\n    ${formatDensity(m)}`);
        }
      }
    }
    expect(floors, "sweep too small to see an archetype-specific defect").toBeGreaterThan(50);
    expect(`${bad.length}/${floors} floors:\n${bad.slice(0, 6).join("\n")}`).toBe(`0/${floors} floors:\n`);
  }, 300000);

  it("the primary road carries the through-line, not a fourth of it", () => {
    // The hierarchy claim, asserted where `routeShare` cannot see it: a floor
    // may hold its route budget while spreading it evenly over four roads, which
    // is the "four equally loud voices and no signal which one reaches the
    // stairs" failure. The primary artery is `routes[0]`, and slip roads run at
    // ALT_PAD_STRIDE = 3x its spacing precisely so it stays the loudest.
    //
    // Measured as: route parts cluster on ONE road rather than spreading. Proxy
    // that needs no access to the route arrays — the route furniture's spread
    // along Φ must be a real slice of the floor, i.e. one long road rather than
    // four short ones huddled near the exit. (decorate.test pins the per-route
    // form directly on the legacy branch.)
    const f = liveFloor(8, 0x2f11 + 8 * 271)!;
    expect(f).toBeTruthy();
    const m = measureDensity(f.plan, f.walkable);
    expect(m.routeParts, "the floor has no through-line at all").toBeGreaterThan(6);
    expect(m.routeShare).toBeLessThan(DEFAULT_DENSITY.maxRouteShare);
  });

  it("the bands are reachable — a deliberately overstuffed floor FAILS", () => {
    // A gate nobody has watched fire cannot be trusted. Take a real floor and
    // quadruple its furniture; every aggregate band must complain.
    const f = liveFloor(6, 0x2f11 + 6 * 271)!;
    const stuffed = {
      ...f.plan,
      parts: [...f.plan.parts, ...f.plan.parts, ...f.plan.parts, ...f.plan.parts],
      props: [...f.plan.props, ...f.plan.props, ...f.plan.props],
    };
    const v = checkDensity(measureDensity(stuffed, f.walkable));
    expect(v.join("; ")).toMatch(/parts\/1k/);
    expect(v.join("; ")).toMatch(/furniture\/1k/);
  });

  it("counts what it says it counts", () => {
    // measureDensity is arithmetic, and arithmetic is where an off-by-one hides
    // behind a plausible-looking number.
    const m = measureDensity(
      { parts: [{ spine: true }, { spine: true }, {}, {}], spawns: [1], torches: [1, 2], props: [], items: [1] },
      1000,
    );
    expect(m.partsPer1k).toBe(4);
    expect(m.routePartsPer1k).toBe(2);
    expect(m.routeShare).toBe(0.5);
    expect(m.tilesPerPart).toBe(250);
    expect(m.furniturePer1k).toBe(8); // 4 parts + 1 spawn + 2 torches + 0 props + 1 item
  });
});
