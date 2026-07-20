import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlayerName, setPlayerName, normalizeName, DEFAULT_NAME, NAME_MAX } from "./player-name";

/**
 * The suite runs in vitest's default NODE environment (no jsdom is installed),
 * so `localStorage` does not exist. We stub it rather than pulling in jsdom —
 * the modules under test only need get/set, and a stub lets us simulate the
 * throwing case exactly, which is the one that matters.
 */
function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>();
  const base: Partial<Storage> = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  (globalThis as any).localStorage = { ...base, ...impl };
}

describe("player name", () => {
  beforeEach(() => installStorage());
  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it("falls back to a real default rather than the server's '???'", () => {
    // Pirate Surf shipped posting with no name, so every row on the shared
    // board rendered identically as "???". That is what this default prevents.
    expect(getPlayerName()).toBe(DEFAULT_NAME);
    expect(getPlayerName()).not.toBe("???");
  });

  it("round-trips a stored name", () => {
    setPlayerName("ZORP");
    expect(getPlayerName()).toBe("ZORP");
  });

  it("clamps to the server's 12-char rule and returns what was stored", () => {
    const stored = setPlayerName("ABCDEFGHIJKLMNOPQRSTUV");
    expect(stored.length).toBe(NAME_MAX);
    expect(getPlayerName()).toBe(stored);
  });

  it("trims, and ignores an all-whitespace name", () => {
    expect(normalizeName("  HI  ")).toBe("HI");
    setPlayerName("REAL");
    setPlayerName("   ");
    expect(getPlayerName()).toBe("REAL");
  });

  it("treats a whitespace-only stored value as unset", () => {
    localStorage.setItem("braindeadbot-player-name", "    ");
    expect(getPlayerName()).toBe(DEFAULT_NAME);
  });

  it("survives storage throwing", () => {
    // Private browsing and sandboxed iframes both do this. A nickname must
    // never be able to take the game down.
    installStorage({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(getPlayerName()).toBe(DEFAULT_NAME);
    expect(() => setPlayerName("NOPE")).not.toThrow();
  });

  it("survives storage being absent entirely", () => {
    // A bare `localStorage` reference throws ReferenceError when undefined —
    // the modules catch it, so this must not blow up either.
    delete (globalThis as any).localStorage;
    expect(getPlayerName()).toBe(DEFAULT_NAME);
    expect(() => setPlayerName("NOPE")).not.toThrow();
  });
});
