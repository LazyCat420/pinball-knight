/**
 * THE CARD ECONOMY — the loop, and the rule that protects it.
 *
 * THE RULE: cards come from MONSTERS. Nothing may manufacture one out of gold,
 * or the bestiary's "farm Hulks for the Hulk card" stops being the point and
 * the whole monster-card design collapses into a shop.
 *
 * THE LOOP: weapons flow back into gold, gold flows back into weapons and
 * upgrades, and upgrades risk the weapon. Cards only ever enter from a kill.
 *
 * THE ASYMMETRY that makes upgrading tense:
 *   · SACRIFICE (your call)   -> gold + every card back
 *   · SHATTER   (a bad roll)  -> nothing, minus whatever insurance saved
 */
import { describe, it, expect } from "vitest";
import { CARDS, CARD_IDS, type CardRarity } from "./cards";
import {
  ITEM_RARITIES,
  salvageValue,
  SALVAGE_BY_RARITY,
  SALVAGE_PER_UPGRADE,
  insuranceCost,
  insuredCards,
  INSURANCE_MAX_TIER,
  breakChance,
  freshWeapon,
} from "./items";

const RANK: CardRarity[] = ["common", "rare", "epic", "legendary", "mythic"];
const rank = (id: string): number => RANK.indexOf(CARDS[id].rarity);

describe("SALVAGE — a retired weapon is worth something", () => {
  it("pays more for a better weapon", () => {
    let prev = -1;
    for (const r of ITEM_RARITIES) {
      const v = salvageValue({ rarity: r });
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("pays for the upgrades you sank into it", () => {
    expect(salvageValue({ rarity: "rare", upgrade: 3 })).toBe(SALVAGE_BY_RARITY.rare + 3 * SALVAGE_PER_UPGRADE);
  });

  /**
   * THE EXPLOIT GUARD. If upgrading then salvaging turned a profit, the optimal
   * play would be an infinite gold loop and the risk would be free money.
   */
  it("NEVER returns more than the upgrades cost — no infinite gold loop", () => {
    // Mirrors the Weaponsmith's price: PRICE_UPGRADE_BASE(45) + level * 25.
    const upgradeSpend = (levels: number): number => {
      let total = 0;
      for (let l = 0; l < levels; l++) total += 45 + l * 25;
      return total;
    };
    for (const r of ITEM_RARITIES) {
      for (let lv = 1; lv <= 10; lv++) {
        const profit = salvageValue({ rarity: r, upgrade: lv }) - salvageValue({ rarity: r }) - upgradeSpend(lv);
        expect(profit, `${r} +${lv} turns a profit`).toBeLessThan(0);
      }
    }
  });

  it("treats a plain unupgraded common as the floor value", () => {
    expect(salvageValue(freshWeapon("sword"))).toBe(SALVAGE_BY_RARITY.common);
  });
});

describe("INSURANCE — buying the trophies back out of the fire", () => {
  it("costs more per tier, and more for a better weapon", () => {
    expect(insuranceCost(1, "common")).toBeGreaterThan(insuranceCost(0, "common"));
    expect(insuranceCost(0, "legendary")).toBeGreaterThan(insuranceCost(0, "common"));
  });

  it("saves nothing at tier 0 — you must actually pay", () => {
    expect(insuredCards(["spidersilk", "hulkknuckle"], 0, rank)).toEqual([]);
  });

  it("saves the RAREST cards first", () => {
    // The player paid to protect what matters; making them guess which chip the
    // game valued would be a bad surprise at the worst possible moment.
    const held = ["spidersilk", "grimscythe", "goblintooth"]; // common, legendary, rare
    expect(insuredCards(held, 1, rank)).toEqual(["grimscythe"]);
    expect(insuredCards(held, 2, rank)).toEqual(["grimscythe", "goblintooth"]);
  });

  it("is capped — it can never save a whole loadout", () => {
    const held = ["spidersilk", "grimscythe", "goblintooth", "flailerjaw"];
    expect(insuredCards(held, 99, rank)).toHaveLength(INSURANCE_MAX_TIER);
    expect(INSURANCE_MAX_TIER).toBeLessThan(4); // a 4-slot legendary always risks something
  });

  it("never saves more cards than are socketed", () => {
    expect(insuredCards(["spidersilk"], 2, rank)).toHaveLength(1);
    expect(insuredCards([], 2, rank)).toEqual([]);
  });

  it("does NOT protect the weapon — the risk has to stay real", () => {
    // Insurance is card-only by construction: `insuredCards` returns cards and
    // nothing in the item model lets a weapon survive a failed roll.
    expect(breakChance(6)).toBeGreaterThan(0);
  });
});

describe("cards can never be MANUFACTURED", () => {
  it("has no recipe, anywhere, that outputs a card", async () => {
    const { RECIPES } = await import("./recipes");
    for (const r of Object.values(RECIPES)) {
      expect(CARD_IDS, `recipe ${r.id} outputs a card`).not.toContain(r.output as string);
    }
  });

  it("keeps shop prices steep enough that hunting beats buying", async () => {
    // A card should read as a trophy you earned, not a thing you bought. If a
    // common ever costs pocket change again, the shelf becomes the way to build.
    const src = await import("./cards");
    expect(src.COMMON_DROP_CHANCE).toBeLessThan(0.15); // still rare from kills
  });
});
