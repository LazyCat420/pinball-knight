/**
 * Keeper cast tests.
 *
 * `buildNpcs` skips any keeper whose role or art is missing, silently — the
 * room just loses a body, nothing throws, and you only find out by looking at a
 * screenshot and counting. That is exactly how the gambler's cabinet shipped
 * unattended, so the join between placement, role and art is asserted here.
 *
 * These are pure-data assertions: no canvas, no renderer.
 */
import { describe, it, expect } from "vitest";
import { KEEPERS } from "./npcs";
import { KEEPER_SPOTS, STATIONS } from "./layout";
import { NPC_PAINTS } from "../dungeon/render/cel-painter";

describe("the keeper cast", () => {
  it("builds a body for every placed keeper — nobody is silently dropped", () => {
    expect(KEEPERS.map((k) => k.id).sort()).toEqual(KEEPER_SPOTS.map((k) => k.id).sort());
  });

  it("the gambler's cabinet is staffed", () => {
    // The whole point: an unattended casino read as unfinished next to four
    // staffed stations.
    const g = KEEPERS.find((k) => k.id === "gambler");
    expect(g, "no keeper at the gambler station").toBeDefined();
    expect(STATIONS.find((s) => s.id === "gambler")).toBeDefined();
  });

  it("every keeper names art that actually exists", () => {
    for (const k of KEEPERS) {
      expect(NPC_PAINTS[k.paintKey], `keeper "${k.id}" has no art for "${k.paintKey}"`).toBeTypeOf("function");
    }
  });

  it("takes its position from the floor plan, never its own copy", () => {
    for (const k of KEEPERS) {
      const spot = KEEPER_SPOTS.find((s) => s.id === k.id)!;
      expect(k.x).toBe(spot.x);
      expect(k.z).toBe(spot.z);
    }
  });

  it("gives the gambler a work loop with a beat, not another idle bob", () => {
    // The brief for the fifth keeper was the smith's hammer, not a fourth sine
    // wave: an asymmetric loop with a rising edge that drives sparks and sound.
    const beats = KEEPERS.filter((k) => k.idle === "hammer" || k.idle === "dart");
    expect(beats.map((k) => k.id).sort()).toEqual(["forge", "gambler"]);
  });

  it("reuses art only across the room, never side by side", () => {
    // There are four NPC paints and five keepers, and cel-painter.ts belongs to
    // the dungeon, so one paint has to be reused. Two identical bodies next to
    // each other read as a bug; at opposite ends of the room they read as two
    // people. The reused one is also tinted.
    const byPaint = new Map<string, typeof KEEPERS>();
    for (const k of KEEPERS) byPaint.set(k.paintKey, [...(byPaint.get(k.paintKey) ?? []), k]);
    for (const [paint, sharing] of byPaint) {
      if (sharing.length < 2) continue;
      for (let i = 0; i < sharing.length; i++) {
        for (let j = i + 1; j < sharing.length; j++) {
          const d = Math.hypot(sharing[i].x - sharing[j].x, sharing[i].z - sharing[j].z);
          expect(d, `"${sharing[i].id}" and "${sharing[j].id}" share "${paint}" and stand ${d.toFixed(1)} apart`).toBeGreaterThan(8);
        }
      }
      // ...and all but one of them is re-tinted, so they aren't literal clones.
      expect(sharing.filter((k) => k.tint === undefined).length, `every "${paint}" is untinted`).toBe(1);
    }
  });

  it("faces each keeper at their own work, so approaching them is a real turn", () => {
    // `home` is the mirror while working. If it already pointed at the player's
    // stand-here spot, the turn-to-face would never visibly fire.
    for (const k of KEEPERS) {
      const s = STATIONS.find((x) => x.id === k.id)!;
      const towardPlayer = s.x >= k.x ? 1 : -1;
      expect(k.home, `keeper "${k.id}" already faces the player's spot; they will never turn`).toBe(-towardPlayer as 1 | -1);
    }
  });
});
