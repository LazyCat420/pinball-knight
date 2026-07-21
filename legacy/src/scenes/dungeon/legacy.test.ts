import { afterEach, describe, expect, it } from "vitest";
import { LEGACY_PERKS, PERK_IDS, loadLegacy, addPerkRank, perkRank, legacyBaseModifiers, hasStartCardPerk, __resetLegacyCache } from "./legacy";

/** node test env has no localStorage — stub a tiny in-memory one. */
function stubStorage(initial?: Record<string, string>): void {
  const store = new Map(Object.entries(initial ?? {}));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  __resetLegacyCache();
});

describe("legacy perks", () => {
  it("survives a save/load round-trip and caps at maxRank", () => {
    stubStorage();
    addPerkRank("veteran");
    addPerkRank("veteran");
    addPerkRank("veteran"); // maxRank 2 — third buy must clamp
    expect(perkRank("veteran")).toBe(2);
    __resetLegacyCache(); // simulate a fresh session reading the same storage
    expect(perkRank("veteran")).toBe(2);
  });

  it("shape-validates a hostile blob instead of importing it", () => {
    stubStorage({
      "pinball-knight-legacy": JSON.stringify({ veteran: 99, oldscar: "yes", bogus: 1, luckycoin: -3 }),
    });
    const st = loadLegacy();
    expect(st.veteran).toBe(LEGACY_PERKS.veteran.maxRank); // clamped, not 99
    expect(st.oldscar).toBeUndefined(); // wrong type dropped
    expect(st.bogus).toBeUndefined(); // unknown perk dropped
    expect(st.luckycoin).toBeUndefined(); // negative dropped
  });

  it("degrades to no perks when storage is unavailable", () => {
    // No stub installed at all — loadLegacy must not throw.
    expect(loadLegacy()).toEqual({});
  });

  it("emits one base modifier per owned rank", () => {
    stubStorage();
    addPerkRank("veteran");
    addPerkRank("veteran");
    addPerkRank("oldscar");
    const base = legacyBaseModifiers();
    expect(base.filter((m) => m.xpMult).length).toBe(2);
    expect(base.filter((m) => m.maxHpFlat).length).toBe(1);
  });

  it("hasStartCardPerk tracks the Pack Rat purchase", () => {
    stubStorage();
    expect(hasStartCardPerk()).toBe(false);
    addPerkRank("packrat");
    expect(hasStartCardPerk()).toBe(true);
  });

  it("every perk is small and priced like a long-term sink", () => {
    for (const id of PERK_IDS) {
      expect(LEGACY_PERKS[id].cost).toBeGreaterThanOrEqual(250);
    }
  });
});
