/**
 * Pinball part RENDERING dispatch tests — the mirror of
 * entities/pinball-collide.test.ts, for the layer that had the same bug shape.
 *
 * The renderer used to dispatch with two long `if (kind === …)` chains: a
 * builder chain whose final `else` built a DEFLECTOR mesh, and an animator
 * chain ending `else if (part.kind !== "pit")` — so a newly added kind
 * type-checked, collided correctly (collision is an exhaustive table), and then
 * either rendered as the wrong part or animated as a deflector reading
 * userData it doesn't own, i.e. rendered nothing. Both are `Record<
 * PinballPartKind, …>` now; these tests pin that shut.
 *
 * Geometry/materials are not asserted (house rule: no rendering assertions) —
 * only that every kind has an entry and that entry runs.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { state, type PinballPart, type PinballPartKind } from "../state";
import { PART_BUILDERS, PART_ANIMATORS, PART_HIT_LIFETIME } from "./pinball-parts";

/** Every kind the game can place. Kept literal so adding one fails here too. */
const ALL_KINDS: PinballPartKind[] = [
  "bumper",
  "spring",
  "ramp",
  "booster",
  "deflector",
  "glove",
  "oil",
  "spinpad",
  "slingshot",
  "target",
  "trapdoor",
  "flipper",
  "mirror",
  "pit",
  "electric",
  "firevent",
  "magstrip",
  "rollover",
];

function makePart(kind: PinballPartKind, mesh: THREE.Group): PinballPart {
  return {
    kind,
    i: 3,
    j: 4,
    x: 0,
    z: 0,
    dirX: 1,
    dirZ: 0,
    dir2X: 0,
    dir2Z: 1,
    cooldownT: 0,
    hitT: -1,
    mesh,
  };
}

describe("render dispatch is exhaustive", () => {
  it("every PinballPartKind has a builder", () => {
    for (const kind of ALL_KINDS) {
      expect(PART_BUILDERS[kind], `no builder for "${kind}"`).toBeTypeOf("function");
    }
  });

  it("every PinballPartKind has an animator", () => {
    for (const kind of ALL_KINDS) {
      expect(PART_ANIMATORS[kind], `no animator for "${kind}"`).toBeTypeOf("function");
    }
  });

  it("every PinballPartKind has a hit-animation lifetime", () => {
    for (const kind of ALL_KINDS) {
      expect(PART_HIT_LIFETIME[kind], `no hit lifetime for "${kind}"`).toBeTypeOf("number");
    }
  });

  it("the tables match the union exactly (no entries for kinds that don't exist)", () => {
    const sorted = [...ALL_KINDS].sort();
    expect(Object.keys(PART_BUILDERS).sort()).toEqual(sorted);
    expect(Object.keys(PART_ANIMATORS).sort()).toEqual(sorted);
    expect(Object.keys(PART_HIT_LIFETIME).sort()).toEqual(sorted);
  });
});

describe("every kind actually renders", () => {
  it("builds a mesh with at least one child — no kind is invisible", () => {
    for (const kind of ALL_KINDS) {
      const mesh = PART_BUILDERS[kind]({ dirX: 1, dirZ: 0, dir2X: 0, dir2Z: 1 });
      expect(mesh, `builder for "${kind}" returned nothing`).toBeInstanceOf(THREE.Group);
      expect(mesh.children.length, `"${kind}" built an empty group`).toBeGreaterThan(0);
    }
  });

  it("animates idle and mid-hit without throwing (each animator reads its OWN userData)", () => {
    for (const kind of ALL_KINDS) {
      const mesh = PART_BUILDERS[kind]({ dirX: 1, dirZ: 0, dir2X: 0, dir2Z: 1 });
      const part = makePart(kind, mesh);
      expect(() => PART_ANIMATORS[kind](part, { dt: 1 / 60, frozen: false }), `idle "${kind}"`).not.toThrow();
      part.hitT = 0.05;
      expect(() => PART_ANIMATORS[kind](part, { dt: 1 / 60, frozen: false }), `hit "${kind}"`).not.toThrow();
      expect(() => PART_ANIMATORS[kind](part, { dt: 1 / 60, frozen: true }), `frozen "${kind}"`).not.toThrow();
    }
    state.pinballParts = [];
  });
});
