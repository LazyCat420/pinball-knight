/**
 * MOVEMENT POLICIES — dispatch totality and the baseline steering contract.
 *
 * Two jobs:
 *
 *  1. The dispatch is EXHAUSTIVE — the same discipline `pinball-collide.test.ts`
 *     keeps over `PART_HANDLERS`. A monster must never be able to fall through
 *     to another policy's steering, and adding a `MovementKind` must fail here
 *     rather than silently inheriting `chase`.
 *  2. The five baseline policies still steer the way the old if/else cascade
 *     steered. These cases were written against the pre-refactor code and are
 *     what makes "behaviour-preserving" a claim someone checked.
 *
 * The module is deliberately three-, state- and DOM-free, so this file needs no
 * mocks at all — which is the whole reason the steering was extracted.
 */
import { describe, it, expect } from "vitest";
import { MOVEMENT_HANDLERS, MOVEMENT_KINDS, type MoveActor, type MoveCtx, type MovementKind } from "./movement";
import { SPITTER_KITE_RANGE, DIRECT_STEER_RANGE, SPITTER_FIRE_RANGE } from "../constants";

/** Every kind the game can steer with. Kept literal so adding one fails here. */
const ALL_KINDS: MovementKind[] = ["chase", "kite", "rooted", "phase", "inert"];

function actor(over: Partial<MoveActor> = {}): MoveActor {
  return { x: 0, z: 0, speed: 2, ...over };
}

/** A context with the player `dist` units away along +x, and a flow heading. */
function ctx(dist: number, over: Partial<MoveCtx> = {}): MoveCtx {
  return {
    dt: 1 / 60,
    pdx: dist,
    pdz: 0,
    pdist: dist,
    flowX: 0,
    flowZ: 1, // deliberately NOT the direct line, so the two are distinguishable
    contactRange: SPITTER_FIRE_RANGE,
    los: true,
    packNear: 0,
    packCommitted: false,
    ...over,
  };
}

describe("dispatch is exhaustive", () => {
  it("every MovementKind has a handler", () => {
    for (const kind of ALL_KINDS) {
      expect(MOVEMENT_HANDLERS[kind], `no handler for "${kind}"`).toBeTypeOf("function");
    }
  });

  it("has no handlers for kinds that don't exist (table matches the union)", () => {
    expect(Object.keys(MOVEMENT_HANDLERS).sort()).toEqual([...ALL_KINDS].sort());
  });

  it("MOVEMENT_KINDS lists exactly the table's keys", () => {
    // The exported list is what the harness and the roster audit iterate; if it
    // drifts from the table, a policy stops being measured without failing.
    expect([...MOVEMENT_KINDS].sort()).toEqual([...ALL_KINDS].sort());
  });

  it("no kind falls through to another kind's steering", () => {
    // The regression in one line: dispatch is a lookup, so a kind can only ever
    // run its OWN policy. Two kinds sharing a function would be fine; a kind
    // being ABSENT is what silently re-creates the cascade.
    for (const kind of ALL_KINDS) expect(kind in MOVEMENT_HANDLERS).toBe(true);
  });
});

describe("chase — the baseline the cascade used to hard-code", () => {
  it("steers STRAIGHT at the player inside DIRECT_STEER_RANGE", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(DIRECT_STEER_RANGE - 0.1));
    expect(s.vx).toBeCloseTo(1, 6);
    expect(s.vz).toBeCloseTo(0, 6);
  });

  it("follows the FLOW FIELD beyond it", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(DIRECT_STEER_RANGE + 0.1));
    expect(s.vx).toBeCloseTo(0, 6);
    expect(s.vz).toBeCloseTo(1, 6);
  });

  it("stands still when it has no field and is out of direct range", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(6, { flowX: 0, flowZ: 0 }));
    expect(s).toMatchObject({ vx: 0, vz: 0 });
  });

  it("does not divide by zero standing on the player", () => {
    const s = MOVEMENT_HANDLERS.chase(actor(), ctx(0));
    expect(Number.isFinite(s.vx) && Number.isFinite(s.vz)).toBe(true);
  });
});

describe("kite — the spitter's range game, unchanged", () => {
  it("RETREATS inside the kite range", () => {
    const s = MOVEMENT_HANDLERS.kite(actor(), ctx(SPITTER_KITE_RANGE - 0.2));
    expect(s.vx).toBeCloseTo(-1, 6);
  });

  it("HOLDS between the kite range and its fire range", () => {
    const s = MOVEMENT_HANDLERS.kite(actor(), ctx((SPITTER_KITE_RANGE + SPITTER_FIRE_RANGE) / 2));
    expect(s).toMatchObject({ vx: 0, vz: 0 });
  });

  it("PATHS IN beyond its fire range", () => {
    const s = MOVEMENT_HANDLERS.kite(actor(), ctx(SPITTER_FIRE_RANGE + 2));
    expect(s.vz).toBeCloseTo(1, 6); // the flow heading
  });
});

describe("rooted / phase / inert", () => {
  it("rooted still FACES you but flags itself immovable", () => {
    // The old code kept steering and multiplied the step by zero, so the facing
    // and the walk clip kept updating. That is preserved on purpose.
    const s = MOVEMENT_HANDLERS.rooted(actor(), ctx(DIRECT_STEER_RANGE - 0.1));
    expect(s.rooted).toBe(true);
    expect(s.vx).toBeCloseTo(1, 6);
  });

  it("phase ignores the flow field entirely — it walks through walls", () => {
    const far = MOVEMENT_HANDLERS.phase(actor(), ctx(12));
    expect(far.vx).toBeCloseTo(1, 6);
    expect(far.vz).toBeCloseTo(0, 6);
  });

  it("inert never steers and never plays a walk", () => {
    expect(MOVEMENT_HANDLERS.inert(actor(), ctx(3))).toMatchObject({ vx: 0, vz: 0, hold: true });
  });
});

describe("handlers are pure with respect to the world", () => {
  it("does not mutate the context", () => {
    const c = ctx(5);
    const snapshot = JSON.stringify(c);
    for (const kind of ALL_KINDS) MOVEMENT_HANDLERS[kind](actor(), c);
    expect(JSON.stringify(c)).toBe(snapshot);
  });

  it("returns finite headings for every kind at every range", () => {
    for (const kind of ALL_KINDS) {
      for (const d of [0, 0.0001, 0.5, 1.6, 3, 7, 40]) {
        const s = MOVEMENT_HANDLERS[kind](actor(), ctx(d));
        expect(Number.isFinite(s.vx), `${kind} @ ${d}`).toBe(true);
        expect(Number.isFinite(s.vz), `${kind} @ ${d}`).toBe(true);
      }
    }
  });
});
