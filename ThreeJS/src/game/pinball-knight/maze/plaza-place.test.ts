/**
 * THE PLAZA PARTS REACH A FLOOR.
 *
 * A builder, a handler and an animator prove a part can EXIST. They prove
 * nothing about whether a player ever meets one — which is exactly the trap the
 * 2026-08-28 audit of this layer wrote up, and the reason the previous set of
 * plan documents was retired: work that was finished and attached to nothing.
 *
 * So this drives the real `decorateMaze` across many seeds and asserts the
 * three new kinds actually land, with the geometry each one needs. Everything
 * here is a claim about placement, not about physics — entities/
 * plaza-parts.test.ts owns what they do once you touch them.
 */
import { describe, it, expect } from "vitest";
import { at, T_FLOOR } from "./generator";
import { liveFloor, sweepFloors, type LiveFloor } from "../testkit/live-floor";

/**
 * The same sweep the density gate runs — every archetype, six depths, two
 * seeds — because the two gates constrain each other. The plaza passes spend
 * what the density cap leaves, so a floor set that is roomier than the real one
 * would let this file pass while `floor-density.test.ts` fails, and a set that
 * is tighter would do the reverse.
 *
 * ⚠️ THIS FILE HAS BEEN WRONG ABOUT ITS FLOORS TWICE, and both times the code
 * it accused was correct. See the header of testkit/live-floor.ts.
 */
const plans: LiveFloor[] = sweepFloors();

/** A floor's peg fields, keyed by the plan's own `field` id — posts AND the
 *  bumpers seeded among them. Never inferred from proximity: two fields can
 *  land side by side, and a distance cluster would merge them. */
function fieldsOf(f: LiveFloor): Map<number, LiveFloor["plan"]["parts"]> {
  const out = new Map<number, LiveFloor["plan"]["parts"]>();
  for (const q of f.plan.parts) {
    if (q.field === undefined) continue;
    const at = out.get(q.field) ?? [];
    at.push(q);
    out.set(q.field, at);
  }
  return out;
}

const partsOfKind = (kind: string) => plans.flatMap((f) => f.plan.parts.filter((q) => q.kind === kind).map((q) => ({ q, g: f.grid })));

describe("the plaza parts are placed at all", () => {
  it("every one of the three reaches real floors", () => {
    // The bar is deliberately "most floors", not "one floor somewhere": a kind
    // that lands on 1 seed in 24 is technically placed and practically absent,
    // which is the state `magstrip` and friends were nearly left in.
    for (const kind of ["swingarm", "flywheel", "magpost"]) {
      const seedsWith = plans.filter((f) => f.plan.parts.some((q) => q.kind === kind)).length;
      expect(seedsWith, `${kind} landed on only ${seedsWith}/${plans.length} floors`).toBeGreaterThan(plans.length * 0.4);
    }
  });
});

describe("swingarm — it needs room to sweep", () => {
  it("every arm has a clear disc around its hub", () => {
    // The hand reaches SWINGARM_LEN from the hub. An arm in a corridor spends
    // most of its rotation inside rock and only works from one side, which is
    // the opposite of what a sweeping hazard is for.
    const arms = partsOfKind("swingarm");
    expect(arms.length).toBeGreaterThan(0);
    for (const { q, g } of arms) {
      for (let dj = -2; dj <= 2; dj++) {
        for (let di = -2; di <= 2; di++) {
          if (di * di + dj * dj > 4) continue;
          expect(at(g, q.i + di, q.j + dj), `arm at ${q.i},${q.j} sweeps into rock`).toBe(T_FLOOR);
        }
      }
    }
  });

  it("both spin directions occur, and every arm carries a phase seed", () => {
    // Two arms in one region should read as a rhythm to time, not as a matched
    // pair — which needs both a direction and a phase to actually vary.
    const arms = partsOfKind("swingarm").map(({ q }) => q);
    expect(new Set(arms.map((q) => q.spin)).size).toBe(2);
    for (const q of arms) {
      expect(q.spin === 1 || q.spin === -1).toBe(true);
      expect(typeof q.phase).toBe("number");
    }
    expect(new Set(arms.map((q) => q.phase)).size).toBeGreaterThan(1);
  });
});

describe("flywheel — it needs a barrel", () => {
  it("every wheel has open floor behind it to enter from and ahead to fire down", () => {
    // Without the run, the barrel fires into a wall and the strongest launcher
    // on the floor is furniture.
    const wheels = partsOfKind("flywheel");
    expect(wheels.length).toBeGreaterThan(0);
    for (const { q, g } of wheels) {
      for (const k of [-2, -1, 1, 2]) {
        expect(at(g, q.i + q.dirI * k, q.j + q.dirJ * k), `flywheel at ${q.i},${q.j} fires into rock`).toBe(T_FLOOR);
      }
    }
  });

  it("is aimed along one axis, never diagonally or nowhere", () => {
    for (const { q } of partsOfKind("flywheel")) {
      expect(Math.abs(q.dirI) + Math.abs(q.dirJ)).toBe(1);
    }
  });
});

describe("magpost — a field, with bumpers in it", () => {
  it("posts arrive in FIELDS, not as scattered singletons", () => {
    // One post on its own is not a cascade.
    const posts = partsOfKind("magpost").map(({ q }) => q);
    expect(posts.length).toBeGreaterThan(0);
    for (const f of plans) {
      for (const [, field] of fieldsOf(f)) {
        expect(field.filter((q) => q.kind === "magpost").length).toBeGreaterThan(2);
      }
    }
  });

  it("every field has BUMPERS mixed into it", () => {
    // The requirement that makes the part playable rather than a sand trap:
    // posts take pace, bumpers give it back. A field of pure posts is the
    // failure mode the whole design is arranged to avoid, so it is asserted
    // per-field — a floor can have plenty of bumpers elsewhere and still have a
    // dead field in it.
    let checked = 0;
    for (const f of plans) {
      for (const [id, field] of fieldsOf(f)) {
        expect(field.filter((q) => q.kind === "bumper").length, `peg field ${id} with no bumper in it`).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the lattice is STAGGERED, not a square grid", () => {
    // A square grid of posts has clear straight lanes between its columns, and
    // a ball that finds one is not cascading — it is in a corridor. Every other
    // row is offset by one, which is the quincunx a real pachinko board uses.
    //
    // The signature of that offset is that (i + j) has ONE parity throughout a
    // field: the lattice occupies a single colour of the checkerboard, where a
    // full square grid would occupy both. So this asserts parity is CONSTANT,
    // which is the opposite of what it sounds like it should say — "staggered"
    // suggests "varied", and asserting variety here passes for a square grid
    // and fails for the correct lattice. It did, on the first version of this.
    //
    // Grouped by the plan's own `field` id rather than by proximity: two fields
    // can land side by side, and a proximity cluster then merges two correct
    // single-parity lattices into one mixed-parity blob. That is what the first
    // version reported as "a square grid at 15,15", and it was neither.
    let checked = 0;
    for (const f of plans) {
      for (const [id, field] of fieldsOf(f)) {
        const posts = field.filter((q) => q.kind === "magpost");
        const parities = new Set(posts.map((q) => (q.i + q.j) % 2));
        expect(parities.size, `field ${id} is a square grid, not a lattice`).toBe(1);
        expect(new Set(posts.map((q) => q.j)).size, `field ${id} is one row`).toBeGreaterThan(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every post carries one of the three cap variants", () => {
    const posts = partsOfKind("magpost").map(({ q }) => q);
    for (const q of posts) expect([0, 1, 2]).toContain(q.variant);
    expect(new Set(posts.map((q) => q.variant)).size).toBeGreaterThan(1);
  });
});

describe("the placement passes do not disturb what was already there", () => {
  it("is deterministic — the same seed builds the same floor twice", () => {
    // The passes draw from the floor's rng. If any of them ever reached for
    // Math.random, co-op peers would disagree about the floor and the census
    // would stop being a fingerprint — both silently.
    const fingerprint = (f: LiveFloor) => f.plan.parts.map((q) => `${q.kind}@${q.i},${q.j}/${q.dirI},${q.dirJ}`).join("|");
    for (const level of [1, 6, 14]) {
      const a = liveFloor(level, 0x2f11 + level * 271, 0);
      const b = liveFloor(level, 0x2f11 + level * 271, 0);
      if (!a || !b) continue;
      expect(fingerprint(a)).toBe(fingerprint(b));
    }
  });

  it("no new part lands on top of an existing one", () => {
    for (const { plan } of plans) {
      const news = plan.parts.filter((q) => q.kind === "swingarm" || q.kind === "flywheel" || q.kind === "magpost");
      for (const q of news) {
        const same = plan.parts.filter((o) => o.i === q.i && o.j === q.j);
        expect(same.length, `${q.kind} stacked at ${q.i},${q.j}`).toBe(1);
      }
    }
  });

  it("no new part lands on the stairs or the start", () => {
    for (const { plan } of plans) {
      const news = plan.parts.filter((q) => q.kind === "swingarm" || q.kind === "flywheel" || q.kind === "magpost");
      for (const q of news) {
        expect(q.i === plan.stairs.i && q.j === plan.stairs.j).toBe(false);
        expect(q.i === plan.start.i && q.j === plan.start.j).toBe(false);
      }
    }
  });
});
