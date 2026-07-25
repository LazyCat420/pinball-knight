/**
 * BESTIARY — the derivation, and the two rules that keep it honest:
 * it must cover every monster, and it must never become a second source of
 * truth for loot (every drop it reports has to trace back to ENEMY_DROPS /
 * CardDef.source).
 */
import { describe, it, expect } from "vitest";
import { buildBestiary, bestiaryProgress, KIND_IDS, KIND_INFO } from "./bestiary";
import { CARDS, CARD_IDS } from "./cards";
import { ENEMY_DROPS } from "./reagents";
import { ZOMBIE_TYPE_IDS } from "./zombie-types";

describe("bestiary coverage", () => {
  it("has an entry for every EnemyKind the drop table knows", () => {
    // ENEMY_DROPS is exhaustive by EnemyKind, so it's the authority on the roster.
    expect(KIND_IDS.sort()).toEqual(Object.keys(ENEMY_DROPS).sort());
  });

  it("labels and blurbs every monster", () => {
    for (const k of KIND_IDS) {
      expect(KIND_INFO[k].label.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].icon.length).toBeGreaterThan(0);
      expect(KIND_INFO[k].blurb.length).toBeGreaterThan(0);
    }
  });

  it("builds one row per monster", () => {
    expect(buildBestiary({})).toHaveLength(KIND_IDS.length);
  });
});

describe("bestiary derivation (no second source of truth)", () => {
  it("reports exactly the reagents ENEMY_DROPS declares", () => {
    for (const e of buildBestiary({})) {
      const expected = (ENEMY_DROPS[e.kind] ?? []).map((d) => d.id).sort();
      expect(e.drops.map((d) => d.id).sort()).toEqual(expected);
      // …and the chances must be the table's, not re-typed numbers.
      for (const d of e.drops) {
        const src = ENEMY_DROPS[e.kind].find((x) => x.id === d.id)!;
        expect(d.chance).toBe(src.chance);
      }
    }
  });

  it("files every source-bearing card under its own monster", () => {
    const byKind = new Map(buildBestiary({}).map((e) => [e.kind, e]));
    for (const id of CARD_IDS) {
      const src = CARDS[id].source;
      if (!src) continue;
      const entry = byKind.get(src)!;
      // A SUB-TYPED card lives on its sub-type row, not the family row — that is
      // what makes "farm Hulks for the Hulk card" a real goal rather than "kill
      // any zombie". Everything else files under the family.
      const sub = CARDS[id].subType;
      const where = sub
        ? entry.subTypes.find((s) => s.id === sub)!.cards
        : entry.cards;
      expect(where.map((c) => c.id), `${id} missing from ${src}${sub ? ":" + sub : ""}`).toContain(id);
    }
  });

  it("never files a sourceless card under a monster", () => {
    for (const e of buildBestiary({})) {
      for (const c of e.cards) expect(CARDS[c.id].source).toBe(e.kind);
    }
  });

  it("orders a monster's cards common → mythic", () => {
    const order = ["common", "rare", "epic", "legendary", "mythic"];
    for (const e of buildBestiary({})) {
      const idx = e.cards.map((c) => order.indexOf(c.rarity));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });

  it("files a sub-typed card on its SUB-TYPE row, not the family row", () => {
    // "Farm Hulks for the Hulk card" only reads if the Hulk card is ON the Hulk
    // row. A sub-typed card leaking onto the Zombie row would say "kill any
    // zombie", which is not the goal the drop table actually implements.
    const zombie = buildBestiary({}).find((e) => e.kind === "zombie")!;
    expect(zombie.cards.every((c) => !CARDS[c.id].subType)).toBe(true);
    const hulk = zombie.subTypes.find((s) => s.id === "hulk")!;
    expect(hulk.cards.map((c) => c.id)).toContain("hulkknuckle");
    // …and it must not also appear under a different sub-type.
    const midget = zombie.subTypes.find((s) => s.id === "midget")!;
    expect(midget.cards.map((c) => c.id)).not.toContain("hulkknuckle");
  });
});

describe("bestiary reveal gating", () => {
  it("marks an unfought monster unseen", () => {
    for (const e of buildBestiary({})) {
      expect(e.seen).toBe(false);
      expect(e.kills).toBe(0);
    }
  });

  it("reveals a monster once it has been killed", () => {
    const e = buildBestiary({ ghost: 3 }).find((x) => x.kind === "ghost")!;
    expect(e.seen).toBe(true);
    expect(e.kills).toBe(3);
    // Its neighbours stay hidden — reveal is per-monster, not global.
    expect(buildBestiary({ ghost: 3 }).find((x) => x.kind === "wisp")!.seen).toBe(false);
  });

  it("tracks progress across the whole roster", () => {
    expect(bestiaryProgress({})).toEqual({ seen: 0, total: KIND_IDS.length });
    const p = bestiaryProgress({ ghost: 1, bat: 4, slime: 2 });
    expect(p.seen).toBe(3);
    expect(p.total).toBe(KIND_IDS.length);
  });
});

describe("zombie sub-type rows", () => {
  const zombieEntry = (kills: Record<string, number> = {}) =>
    buildBestiary(kills).find((e) => e.kind === "zombie")!;

  it("lists every sub-type under the zombie, and nowhere else", () => {
    expect(zombieEntry().subTypes.map((s) => s.id).sort()).toEqual([...ZOMBIE_TYPE_IDS].sort());
    for (const e of buildBestiary({})) {
      if (e.kind !== "zombie") expect(e.subTypes).toHaveLength(0);
    }
  });

  it("resolves each sub-type's real HP off the ZOMBIE_HP baseline", () => {
    const rows = new Map(zombieEntry().subTypes.map((s) => [s.id, s]));
    expect(rows.get("shambler")!.hp).toBe(3);
    expect(rows.get("hulk")!.hp).toBe(9);
    expect(rows.get("runner")!.hp).toBe(2);
  });

  it("describes only what DIFFERS from the baseline", () => {
    const rows = new Map(zombieEntry().subTypes.map((s) => [s.id, s]));
    // The shambler IS the baseline, so it has nothing to say.
    expect(rows.get("shambler")!.notes).toEqual([]);
    // …and everything else must say something, or the row teaches nothing.
    for (const t of ZOMBIE_TYPE_IDS) {
      if (t === "shambler") continue;
      expect(rows.get(t)!.notes.length, `${t} has no notes`).toBeGreaterThan(0);
    }
    expect(rows.get("crawler")!.notes.join(" ")).toContain("legless");
    expect(rows.get("hobbler")!.notes.join(" ")).toContain("limps");
    expect(rows.get("hulk")!.notes.join(" ")).toContain("knocks you");
  });

  it("reveals a sub-type only once that specific one has been killed", () => {
    const rows = new Map(zombieEntry({ zombie: 5, "zombie:hulk": 1 }).subTypes.map((s) => [s.id, s]));
    expect(rows.get("hulk")!.seen).toBe(true);
    expect(rows.get("hulk")!.kills).toBe(1);
    expect(rows.get("crawler")!.seen).toBe(false);
  });

  it("counts the shambler as met after any plain zombie kill", () => {
    // The shambler is the baseline and carries no `ztype` on the actor, so it has
    // no `zombie:shambler` tally to read — it is the family total minus the
    // tagged sub-types.
    expect(zombieEntry({ zombie: 1 }).subTypes.find((s) => s.id === "shambler")!.seen).toBe(true);
    expect(zombieEntry({}).subTypes.find((s) => s.id === "shambler")!.seen).toBe(false);
  });

  /**
   * REGRESSION (found in live QA, 2026-07-25): the bestiary rendered
   * "Shambler 3 hp x0" beside sub-types showing x6, because `kills` was read
   * from the non-existent `zombie:shambler` key while `seen` fell back to the
   * family total. A visible zero on the one kind you have definitely been
   * killing reads as a broken tally.
   */
  it("derives the shambler COUNT as the family total minus tagged sub-types", () => {
    const rows = new Map(
      zombieEntry({ zombie: 46, "zombie:runner": 6, "zombie:hulk": 6, "zombie:crawler": 5 })
        .subTypes.map((s) => [s.id, s]),
    );
    expect(rows.get("shambler")!.kills).toBe(46 - 17);
    expect(rows.get("shambler")!.seen).toBe(true);
    expect(rows.get("runner")!.kills).toBe(6);
  });

  it("never reports a negative shambler count", () => {
    // Sub-type keys can outnumber the family total if a tally is ever seeded
    // out of order; clamp rather than render "x-3".
    const s = zombieEntry({ zombie: 1, "zombie:hulk": 5 }).subTypes.find((r) => r.id === "shambler")!;
    expect(s.kills).toBe(0);
    expect(s.seen).toBe(false);
  });
});
