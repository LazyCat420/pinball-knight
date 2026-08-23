import { describe, it, expect } from "vitest";
import { mulberry32 } from "./generator";
import { MODIFIERS, NO_MODIFIER, MODIFIER_FROM_LEVEL, modifierById, rollModifier } from "./modifiers";

describe("floor modifiers", () => {
  it("every modifier keeps its multipliers in a sane band", () => {
    // A modifier scales budgets; a zero or a wild multiplier would produce a
    // pitch-dark or unplayable floor rather than a twist.
    for (const m of MODIFIERS) {
      for (const [k, v] of [
        ["torchMult", m.torchMult],
        ["partMult", m.partMult],
        ["hordeMult", m.hordeMult],
        ["hazardMult", m.hazardMult],
        ["trapdoorMult", m.trapdoorMult],
      ] as const) {
        expect(v, `${m.id}.${k}`).toBeGreaterThan(0);
        expect(v, `${m.id}.${k}`).toBeLessThanOrEqual(3);
      }
      expect(m.bonusItems).toBeGreaterThanOrEqual(0);
      expect(m.bonusItems).toBeLessThanOrEqual(5);
    }
  });

  it("every modifier except 'none' is announceable", () => {
    // An unannounced modifier reads as a bug, so each needs a label + flavour.
    for (const m of MODIFIERS) {
      if (m.id === "none") continue;
      expect(m.label.length, m.id).toBeGreaterThan(0);
      expect(m.flavour.length, m.id).toBeGreaterThan(0);
    }
  });

  it("'none' is inert — it changes no budget", () => {
    expect(NO_MODIFIER.id).toBe("none");
    expect(NO_MODIFIER.torchMult).toBe(1);
    expect(NO_MODIFIER.partMult).toBe(1);
    expect(NO_MODIFIER.hordeMult).toBe(1);
    expect(NO_MODIFIER.hazardMult).toBe(1);
    expect(NO_MODIFIER.trapdoorMult).toBe(1);
    expect(NO_MODIFIER.bonusItems).toBe(0);
    expect(NO_MODIFIER.dealBias).toEqual([]);
  });

  it("ids are unique", () => {
    expect(new Set(MODIFIERS.map((m) => m.id)).size).toBe(MODIFIERS.length);
  });

  it("never rolls one on the opening floors", () => {
    for (let level = 1; level < MODIFIER_FROM_LEVEL; level++) {
      for (let seed = 1; seed <= 60; seed++) {
        expect(rollModifier(level, mulberry32(seed)).id, `level ${level} seed ${seed}`).toBe("none");
      }
    }
  });

  it("is deterministic for a given seed", () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(rollModifier(7, mulberry32(seed)).id).toBe(rollModifier(7, mulberry32(seed)).id);
    }
  });

  it("rolls a mix — neither always-none nor always-modified", () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 400; seed++) {
      const id = rollModifier(9, mulberry32(seed)).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get("none") ?? 0).toBeGreaterThan(0);
    // Every non-none modifier should be reachable over 400 draws.
    for (const m of MODIFIERS) {
      if (m.id === "none") continue;
      expect(counts.get(m.id) ?? 0, `${m.id} never rolled`).toBeGreaterThan(0);
    }
  });

  it("modifierById round-trips and falls back safely", () => {
    for (const m of MODIFIERS) expect(modifierById(m.id).id).toBe(m.id);
    // @ts-expect-error — deliberately unknown id
    expect(modifierById("nonsense").id).toBe("none");
  });
});
