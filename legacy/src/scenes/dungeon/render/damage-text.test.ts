/**
 * Pure-logic tests for the floating damage numbers. The pool itself needs a
 * canvas + WebGL, but formatting, styling and the motion curve are pure — and
 * they're the parts that carry the actual design rules.
 */
import { describe, it, expect } from "vitest";
import { formatDamage, damageTextStyle, damageTextFrame, POOL_SIZE } from "./damage-text";

describe("formatDamage", () => {
  it("rounds fractional damage to a whole number", () => {
    expect(formatDamage(3.4)).toBe("3");
    expect(formatDamage(3.6)).toBe("4");
    expect(formatDamage(12)).toBe("12");
  });

  it("never shows 0 for a connected hit — a 0 reads as a miss", () => {
    expect(formatDamage(0.2)).toBe("1");
    expect(formatDamage(0.49)).toBe("1");
  });

  it("drops non-positive and non-finite amounts entirely", () => {
    expect(formatDamage(0)).toBe("");
    expect(formatDamage(-5)).toBe("");
    expect(formatDamage(NaN)).toBe("");
    expect(formatDamage(Infinity)).toBe("");
  });

  it("emits DIGITS ONLY — Press Start 2P has no symbol glyphs", () => {
    for (const n of [1, 7, 42, 999, 9999, 3.7]) {
      expect(formatDamage(n)).toMatch(/^\d+$/);
    }
  });
});

describe("damageTextStyle", () => {
  it("reads damage taken as red and damage dealt as light", () => {
    expect(damageTextStyle(5, "in").color).toBe(0xff5563);
    expect(damageTextStyle(5, "out").color).not.toBe(0xff5563);
  });

  it("makes a crit visibly bigger than any ordinary hit of the same size", () => {
    expect(damageTextStyle(5, "crit").scale).toBeGreaterThan(damageTextStyle(5, "out").scale);
    // ...and bigger than even a huge ordinary hit, so a crit always reads as one
    expect(damageTextStyle(1, "crit").scale).toBeGreaterThan(damageTextStyle(9999, "out").scale);
  });

  it("scales up with magnitude within a kind", () => {
    expect(damageTextStyle(20, "out").scale).toBeGreaterThan(damageTextStyle(2, "out").scale);
    expect(damageTextStyle(20, "in").scale).toBeGreaterThan(damageTextStyle(2, "in").scale);
  });

  it("keeps every number smaller than the knight's head", () => {
    // The head is the reference: a damage number annotates the fight, it does
    // not cover it. Derived the same way the renderer derives it — helm dome is
    // 26px in the 128px cel box, on a 1.1 world-unit actor plane; the glyph is
    // FONT_PX 24 of a 64px texture on a 64/PPU quad.
    const HEAD_WORLD_H = (26 / 128) * 1.1;
    const GLYPH_WORLD_H = (24 / 64) * (64 / 64);

    // Sweep the whole damage range including absurd values, every kind — and
    // measure at the POP PEAK, because a number is at its biggest the instant it
    // spawns. Checking the settled size only would let the punch-in frame blow
    // straight past the head.
    const peak = damageTextFrame(0, 1).scale;
    expect(peak).toBeGreaterThan(1); // guard: the overshoot is real

    for (const kind of ["out", "in", "crit"] as const) {
      for (const amount of [1, 2, 5, 12, 24, 100, 9999, 1e9]) {
        const h = damageTextStyle(amount, kind).scale * GLYPH_WORLD_H * peak;
        expect(h).toBeLessThan(HEAD_WORLD_H);
      }
    }
  });

  it("saturates rather than growing without bound on absurd damage", () => {
    // the debug nuke passes 9999 — it must not produce a screen-filling glyph
    expect(damageTextStyle(9999, "out").scale).toBeLessThan(2);
    expect(damageTextStyle(1e9, "crit").scale).toBeLessThan(3);
  });

  it("gives every kind a positive, bounded lifetime", () => {
    for (const k of ["out", "crit", "in"] as const) {
      const s = damageTextStyle(10, k);
      expect(s.life).toBeGreaterThan(0);
      expect(s.life).toBeLessThan(2);
    }
  });
});

describe("damageTextFrame", () => {
  it("is fully opaque for the first half, then fades to nothing", () => {
    expect(damageTextFrame(0, 1).alpha).toBe(1);
    expect(damageTextFrame(0.5, 1).alpha).toBe(1);
    expect(damageTextFrame(0.75, 1).alpha).toBeCloseTo(0.5, 5);
    expect(damageTextFrame(1, 1).alpha).toBeCloseTo(0, 5);
  });

  it("pops above 1 on spawn then settles to 1", () => {
    expect(damageTextFrame(0, 1).scale).toBeCloseTo(1.45, 5);
    expect(damageTextFrame(0.16, 1).scale).toBe(1);
    expect(damageTextFrame(0.9, 1).scale).toBe(1);
  });

  it("rises monotonically and decelerates", () => {
    const a = damageTextFrame(0, 1).rise;
    const b = damageTextFrame(0.25, 1).rise;
    const c = damageTextFrame(0.5, 1).rise;
    const d = damageTextFrame(1, 1).rise;
    expect(a).toBe(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
    // ease-out: the first half covers more ground than the second
    expect(c - a).toBeGreaterThan(d - c);
  });

  it("clamps outside its lifetime instead of extrapolating", () => {
    expect(damageTextFrame(-1, 1).alpha).toBe(1);
    expect(damageTextFrame(5, 1).alpha).toBeCloseTo(0, 5);
    expect(damageTextFrame(5, 1).rise).toBeCloseTo(0.95, 5);
  });

  it("survives a zero lifetime without dividing by zero", () => {
    const f = damageTextFrame(1, 0);
    expect(Number.isFinite(f.alpha)).toBe(true);
    expect(Number.isFinite(f.rise)).toBe(true);
    expect(Number.isFinite(f.scale)).toBe(true);
  });

  it("is scale-invariant in age/life ratio", () => {
    expect(damageTextFrame(0.4, 0.8)).toEqual(damageTextFrame(1.0, 2.0));
  });
});

describe("pooling", () => {
  it("is bounded — a busy floor must not allocate per hit", () => {
    expect(POOL_SIZE).toBeGreaterThan(8);
    expect(POOL_SIZE).toBeLessThanOrEqual(64);
  });
});
