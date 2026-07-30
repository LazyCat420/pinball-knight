import { describe, it, expect } from "vitest";
import {
  WALL_SURFACES,
  FLOOR_SURFACES,
  MATERIALS,
  WALL_STONE,
  FLOOR_STONE,
  MAT_STONE,
  MAT_MUD,
  MAT_ICE,
  wallSurface,
  floorSurface,
  material,
  mergeMix,
  pickSurface,
} from "./surfaces";

describe("surface tables", () => {
  /**
   * THE LOAD-BEARING TEST. Index 0 of both tables is the pre-surfaces
   * behaviour, and every consumer multiplies by it unconditionally. If a
   * "tuning pass" ever nudges stone's restitution to 0.98, every floor in the
   * game silently changes feel and nothing else in the suite would catch it.
   */
  it("stone is EXACTLY neutral in both vocabularies", () => {
    const w = wallSurface(WALL_STONE);
    expect(w.flatRestMult).toBe(1);
    expect(w.bounceAdd).toBe(0);
    expect(w.cornerMult).toBe(1);
    expect(w.comboTicks).toBe(1); // one bounce, one combo step — the historical rule
    expect(w.breaksCombo).toBe(false);
    expect(w.hex).toBe(0xffffff); // identity tint leaves the authored texture alone

    const f = floorSurface(FLOOR_STONE);
    expect(f.frictionMult).toBe(1);
    expect(f.steerMult).toBe(1);
    expect(f.walkMult).toBe(1);
    // No floor `hex` any more — the field was dead and carried four off-palette
    // colours next to a pass that snaps the albedo. See the note on
    // FLOOR_SURFACES. The WALL tint above is live and still asserted.
  });

  it("never returns undefined for an unknown or missing id", () => {
    // The physics reads these every frame and must not branch on absence.
    expect(wallSurface(undefined).id).toBe(WALL_STONE);
    expect(wallSurface(999).id).toBe(WALL_STONE);
    expect(floorSurface(undefined).id).toBe(FLOOR_STONE);
    expect(floorSurface(-1).id).toBe(FLOOR_STONE);
    expect(material(999).id).toBe(MAT_STONE);
  });

  it("table indices match their own ids", () => {
    // Both tables are looked up by ARRAY INDEX, so a row inserted in the middle
    // without renumbering would hand every surface the neighbour's physics.
    WALL_SURFACES.forEach((s, i) => expect(s.id).toBe(i));
    FLOOR_SURFACES.forEach((s, i) => expect(s.id).toBe(i));
    MATERIALS.forEach((m, i) => expect(m.id).toBe(i));
  });

  it("every material points at real rows in both tables", () => {
    for (const m of MATERIALS) {
      expect(WALL_SURFACES[m.wall]).toBeDefined();
      expect(FLOOR_SURFACES[m.floor]).toBeDefined();
    }
  });

  it("only mud breaks the chain, and it also stops building it", () => {
    const breakers = WALL_SURFACES.filter((s) => s.breaksCombo);
    expect(breakers).toHaveLength(1);
    expect(breakers[0].comboTicks).toBe(0); // breaking AND ticking would be incoherent
  });

  it("a gaining wall gains and a damping wall damps", () => {
    // Guards the direction of the multipliers — a sign slip here would make the
    // punishing surface the best one on the floor.
    const rubber = wallSurface(MATERIALS[1].wall);
    expect(rubber.flatRestMult).toBeGreaterThan(1);
    expect(rubber.bounceAdd).toBeGreaterThan(0);
    const mud = wallSurface(material(MAT_MUD).wall);
    expect(mud.flatRestMult).toBeLessThan(1);
    expect(mud.cornerMult).toBeLessThan(1);
  });

  it("ice keeps speed but not grip", () => {
    const f = floorSurface(material(MAT_ICE).floor);
    expect(f.frictionMult).toBeLessThan(0.5);
    expect(f.steerMult).toBeLessThan(0.5);
  });
});

describe("mixes", () => {
  it("mergeMix sums weights rather than replacing them", () => {
    // A modifier leaning a theme must not erase it.
    expect(mergeMix({ 1: 2 }, { 1: 3, 2: 1 })).toEqual({ 1: 5, 2: 1 });
  });

  it("mergeMix tolerates undefined and drops non-positive weights", () => {
    expect(mergeMix(undefined, { 1: 0, 2: 4 }, undefined)).toEqual({ 2: 4 });
  });

  it("pickSurface returns the fallback for an empty mix", () => {
    expect(pickSurface({}, () => 0.5, 7)).toBe(7);
  });

  it("pickSurface consumes exactly one rng call regardless of table size", () => {
    // The painter runs per patch over a whole floor; a draw whose rng cost
    // depended on the weights would make the stream irreproducible the moment
    // a theme gained an entry.
    let calls = 0;
    const rand = (): number => {
      calls++;
      return 0.99;
    };
    pickSurface({ 1: 1, 2: 1, 3: 1, 4: 1 }, rand);
    expect(calls).toBe(1);
  });

  it("pickSurface respects the weights", () => {
    // 9:1 — the low draw lands in the heavy bucket, the high draw in the light one.
    const mix = { 1: 9, 2: 1 };
    expect(pickSurface(mix, () => 0.1)).toBe(1);
    expect(pickSurface(mix, () => 0.95)).toBe(2);
  });
});
