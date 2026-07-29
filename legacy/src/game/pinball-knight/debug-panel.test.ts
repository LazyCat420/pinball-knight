/**
 * The debug panel's spawn chips must cover the WHOLE roster.
 *
 * This test exists because the list drifted twice: `reaper` was never in it,
 * and `sporeling` was missing on the day it shipped — so the one monster most
 * in need of looking at was the one the panel could not spawn. `tsc` cannot
 * catch it (the old list was `Array<{kind: string}>`, and a missing ENTRY is
 * not a type error anyway), so the guard has to be a test.
 */
import { describe, expect, it } from "vitest";
import { SPAWNABLE } from "./debug-panel";
import { KIND_IDS } from "./bestiary";

describe("debug panel spawn chips", () => {
  it("covers every EnemyKind in the bestiary roster", () => {
    const chips = new Set(SPAWNABLE.map((s) => s.kind));
    const missing = (KIND_IDS as string[]).filter((k) => !chips.has(k));
    expect(missing, `debug panel cannot spawn: ${missing.join(", ")}`).toEqual([]);
  });

  it("spawns nothing that is not a real kind", () => {
    const roster = new Set(KIND_IDS as string[]);
    const bogus = SPAWNABLE.map((s) => s.kind).filter((k) => !roster.has(k));
    expect(bogus, `debug panel lists unknown kinds: ${bogus.join(", ")}`).toEqual([]);
  });

  it("gives every chip a non-empty label that fits the narrow panel", () => {
    for (const chip of SPAWNABLE) {
      expect(chip.label.trim(), `${chip.kind} has no label`).not.toBe("");
      // The panel is a narrow column of chips; long bestiary names ("Bowling
      // Pin", "Death Dealer") overflow it, which is what LABEL_OVERRIDE is for.
      expect(chip.label.length, `${chip.kind} label "${chip.label}" is too long for the panel`).toBeLessThanOrEqual(16);
    }
  });
});
