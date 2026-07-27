/**
 * Pure tests for the reagent drop system — the themed per-enemy table and the
 * seeded drop roll. Art/spawn (motes) is not tested (house rule); this covers
 * the numbers gameplay balance depends on and the exhaustive-by-kind invariant.
 */
import { describe, it, expect } from "vitest";
import { REAGENTS, REAGENT_IDS, ENEMY_DROPS, rollReagentDrops, type ReagentId } from "./reagents";
import type { EnemyKind } from "./state";

const ALL_KINDS: EnemyKind[] = [
  "zombie", "spider", "brute", "spitter", "ghost", "bat", "slime",
  "reaper", "goblin", "pin", "golem", "chomper", "magnet", "webspinner",
];

/** A deterministic RNG that always returns the same value — makes each entry's
 * independent roll (rand() < chance) fully predictable. */
const constRand = (v: number) => () => v;

describe("reagent table", () => {
  it("every reagent id round-trips through its def", () => {
    for (const id of REAGENT_IDS) expect(REAGENTS[id].id).toBe(id);
  });

  it("every enemy kind has a themed drop table pointing at real reagents", () => {
    for (const kind of ALL_KINDS) {
      const table = ENEMY_DROPS[kind];
      expect(table, `${kind} has no drop table`).toBeTruthy();
      expect(table.length).toBeGreaterThan(0);
      for (const entry of table) {
        expect(REAGENTS[entry.id], `${kind} drops unknown ${entry.id}`).toBeTruthy();
        expect(entry.chance).toBeGreaterThan(0);
        expect(entry.chance).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("rollReagentDrops", () => {
  it("drops everything in the table when every roll passes", () => {
    // rand()=0 is below every chance, so all entries fire.
    const drops = rollReagentDrops("golem", {}, constRand(0));
    expect(drops).toContain("ironshard");
    expect(drops).toContain("glass");
  });

  it("drops nothing when every roll fails", () => {
    // rand()=0.999 is above every chance in the table.
    expect(rollReagentDrops("slime", {}, constRand(0.999))).toEqual([]);
  });

  it("respects the per-entry chance threshold", () => {
    // slime drops slimegel at 0.30 — a roll of 0.2 passes, 0.4 fails.
    expect(rollReagentDrops("slime", {}, constRand(0.2))).toEqual(["slimegel"]);
    expect(rollReagentDrops("slime", {}, constRand(0.4))).toEqual([]);
  });

  it("a boss always yields a Grim Bone plus a second helping", () => {
    // Even with every table roll failing, the boss still guarantees grimbone.
    const drops = rollReagentDrops("zombie", { boss: true }, constRand(0.999));
    expect(drops).toEqual(["grimbone"]);
    // With every roll passing, the boss gets its kind's drop twice + grimbone.
    const rich = rollReagentDrops("zombie", { boss: true }, constRand(0));
    expect(rich.filter((d) => d === "rotflesh").length).toBe(2);
    expect(rich).toContain("grimbone");
  });

  it("only ever returns known reagent ids", () => {
    const seen = new Set<ReagentId>();
    let seq = 0;
    const rand = () => (seq++ % 10) / 10; // 0,0.1,…,0.9 cycling
    for (const kind of ALL_KINDS) {
      for (let n = 0; n < 20; n++) for (const id of rollReagentDrops(kind, { boss: n % 2 === 0 }, rand)) seen.add(id);
    }
    for (const id of seen) expect(REAGENT_IDS).toContain(id);
  });
});
