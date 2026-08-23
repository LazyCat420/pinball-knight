import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PILES_PER_FLOOR,
  addPile,
  canLoot,
  clearPile,
  clearResumeFloor,
  floorsWithPiles,
  loadResumeFloor,
  localKnightId,
  pilesOnFloor,
  saveResumeFloor,
  __resetCorpseCache,
  type CorpseItem,
} from "./corpse-run";

/** node test env has no localStorage — stub a tiny in-memory one. */
function stubStorage(initial?: Record<string, string>): void {
  const store = new Map(Object.entries(initial ?? {}));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

const KIT: CorpseItem[] = [{ kind: "weapon", id: "sword", durability: 40 }];

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  __resetCorpseCache();
});

describe("corpse piles", () => {
  it("survives a save/load round-trip", () => {
    stubStorage();
    const me = localKnightId();
    addPile(7, 3, 4, me, KIT);
    __resetCorpseCache(); // simulate a fresh session reading the same storage
    const piles = pilesOnFloor(7);
    expect(piles).toHaveLength(1);
    expect(piles[0].items[0]).toMatchObject({ kind: "weapon", id: "sword", durability: 40 });
    expect(piles[0].owner).toBe(me);
  });

  it("ACCUMULATES piles — dying again never replaces the pile you were going for", () => {
    stubStorage();
    addPile(7, 1, 1, "me", [{ kind: "weapon", id: "sword" }]);
    addPile(7, 9, 9, "me", [{ kind: "gear", id: "helm" }]);
    addPile(7, 5, 5, "me", [{ kind: "card", id: "ember" }]);
    // This is the load-bearing rule: three deaths, three recoverable piles.
    expect(pilesOnFloor(7)).toHaveLength(3);
  });

  it("keeps floors independent", () => {
    stubStorage();
    addPile(3, 1, 1, "me", KIT);
    addPile(7, 1, 1, "me", KIT);
    expect(pilesOnFloor(3)).toHaveLength(1);
    expect(pilesOnFloor(7)).toHaveLength(1);
    expect(floorsWithPiles()).toEqual([3, 7]);
  });

  it("drops nothing when there is nothing to drop", () => {
    stubStorage();
    expect(addPile(7, 1, 1, "me", [])).toBeNull();
    expect(pilesOnFloor(7)).toHaveLength(0);
  });

  it("MERGES rather than discards when a floor hits the pile cap", () => {
    stubStorage();
    for (let n = 0; n < MAX_PILES_PER_FLOOR + 3; n++) {
      addPile(7, n, n, "me", [{ kind: "card", id: `card-${n}` }]);
    }
    const piles = pilesOnFloor(7);
    expect(piles).toHaveLength(MAX_PILES_PER_FLOOR);
    // Every single card must still be recoverable — a silent cap that ate gear
    // would break the promise the whole module exists to make.
    const ids = piles.flatMap((p) => p.items.map((i) => i.id)).sort();
    expect(ids).toHaveLength(MAX_PILES_PER_FLOOR + 3);
    expect(ids).toContain("card-0");
    expect(ids).toContain("card-1");
  });

  it("clears a pile once it has been recovered", () => {
    stubStorage();
    const p = addPile(7, 1, 1, "me", KIT);
    clearPile(p!.id);
    expect(pilesOnFloor(7)).toHaveLength(0);
  });

  it("shape-validates a hostile blob instead of importing it", () => {
    stubStorage({
      "pinball-knight-corpse-runs": JSON.stringify({
        piles: [
          { id: "ok", floor: 4, x: 1, z: 2, owner: "me", items: [{ kind: "weapon", id: "axe" }, { kind: "bogus", id: "x" }, 7] },
          { id: "bad-floor", floor: -1, x: 1, z: 2, items: [] },
          { id: "bad-coord", floor: 2, x: "nope", z: 2, items: [] },
          null,
        ],
      }),
    });
    const piles = pilesOnFloor(4);
    expect(piles).toHaveLength(1);
    expect(piles[0].items).toHaveLength(1); // non-item entries dropped
    expect(piles[0].items[0].id).toBe("axe");
    expect(floorsWithPiles()).toEqual([4]); // malformed piles never loaded
  });

  it("does not throw when storage is unavailable", () => {
    // No stubStorage() call — localStorage is undefined, as in a sandboxed frame.
    expect(() => addPile(7, 1, 1, "me", KIT)).not.toThrow();
    expect(() => pilesOnFloor(7)).not.toThrow();
    expect(() => saveResumeFloor(7)).not.toThrow();
    expect(loadResumeFloor()).toBe(0);
  });
});

describe("corpse ownership", () => {
  const pile = { id: "p", floor: 7, x: 0, z: 0, owner: "peer-a", items: KIT };

  it("lets the owner loot their own corpse", () => {
    expect(canLoot(pile, "peer-a")).toBe(true);
  });

  it("does NOT let another knight on the same floor strip it", () => {
    expect(canLoot(pile, "peer-b")).toBe(false);
  });

  it("leaves a solo/offline pile lootable — there is no second claimant", () => {
    expect(canLoot({ ...pile, owner: "" }, null)).toBe(true);
    expect(canLoot({ ...pile, owner: "" }, "peer-b")).toBe(true);
  });
});

/**
 * THE LOCKOUT. Piles used to be stamped with `myId()` — the POOL SOCKET id,
 * minted per connection. So the moment you reconnected (or came back the next
 * day, or played offline where `myId()` is null) your own kit failed `canLoot`
 * and the game told you it was "another knight's kit — not yours to take".
 * Every corpse a player had ever left was permanently unrecoverable.
 */
describe("your own kit outlives the socket that dropped it", () => {
  it("is lootable OFFLINE, where the pool id is null", () => {
    stubStorage();
    const me = localKnightId();
    expect(canLoot({ id: "p", floor: 7, x: 0, z: 0, owner: me, items: KIT }, null)).toBe(true);
  });

  it("is lootable after a reconnect handed out a different socket id", () => {
    stubStorage();
    const me = localKnightId();
    expect(canLoot({ id: "p", floor: 7, x: 0, z: 0, owner: me, items: KIT }, "a-brand-new-socket")).toBe(true);
  });

  it("keeps the same knight id across sessions", () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    const first = localKnightId();
    __resetCorpseCache(); // new session, same browser storage
    expect(localKnightId()).toBe(first);
  });

  it("ADOPTS a pile stamped with a dead socket id, so old corpses un-strand", () => {
    // Exactly what a player who died under the broken version has in storage.
    // Nothing ever writes another player's pile into your save, so a foreign
    // owner here is always a stale socket id — never a real second claimant.
    stubStorage({
      "pinball-knight-corpse-runs": JSON.stringify({
        piles: [{ id: "c5-old", floor: 5, x: 1, z: 2, owner: "socket-from-a-dead-session", items: KIT }],
      }),
    });
    const piles = pilesOnFloor(5);
    expect(piles).toHaveLength(1);
    expect(piles[0].owner).toBe(localKnightId());
    expect(canLoot(piles[0], null)).toBe(true);
    expect(piles[0].items[0]).toMatchObject({ kind: "weapon", id: "sword" });
  });

  it("persists the adoption, so the repair happens once", () => {
    const store = {
      "pinball-knight-corpse-runs": JSON.stringify({
        piles: [{ id: "c5-old", floor: 5, x: 1, z: 2, owner: "socket-from-a-dead-session", items: KIT }],
      }),
    };
    stubStorage(store);
    const me = localKnightId();
    pilesOnFloor(5);
    const written = JSON.parse(localStorage.getItem("pinball-knight-corpse-runs")!) as { piles: Array<{ owner: string }> };
    expect(written.piles[0].owner).toBe(me);
  });

  it("still refuses a pile that is genuinely someone else's live session", () => {
    // The co-op promise survives: adoption only ever runs on what LOAD reads out
    // of local storage. A pile handed to canLoot directly with a foreign owner —
    // the shape a future wire-synced pile would have — is still refused.
    stubStorage();
    expect(canLoot({ id: "p", floor: 7, x: 0, z: 0, owner: "peer-b", items: KIT }, "peer-c")).toBe(false);
  });
});

describe("resume floor", () => {
  it("round-trips the floor you died on", () => {
    stubStorage();
    saveResumeFloor(7);
    expect(loadResumeFloor()).toBe(7);
    clearResumeFloor();
    expect(loadResumeFloor()).toBe(0);
  });

  it("rejects a junk value rather than sending you to floor NaN", () => {
    stubStorage({ "pinball-knight-resume-floor": "banana" });
    expect(loadResumeFloor()).toBe(0);
  });
});
