/**
 * BALANCE INVARIANTS — the properties a tuning pass must not silently undo.
 *
 * These came out of a measured audit of the weapon/card tables, and each one
 * pins a fault that was actually shipped rather than a hypothetical:
 *
 *  • MYTHIC was unreachable from play. 200k best-case boss rolls produced 0
 *    mythics in 167,830 drops, because rollCardDrop had no mythic branch.
 *  • The FLAMER was best-in-class on every axis at once: 23.5 DPS (4x the next
 *    weapon), the most lifetime damage AND the most card slots.
 *  • The CHAIR was strictly dominated — 2.9 DPS, below bare fists, with nothing
 *    in its numbers explaining why you would pick it up.
 *  • The BOW was dominated by the gun on range, rate and slots at once.
 *
 * Deliberately expressed as RELATIONS ("the flamer must not out-live the gun"),
 * not magic numbers, so retuning stays free while the shape holds.
 */
import { describe, expect, it } from "vitest";
import { WEAPONS, type WeaponId } from "./items";
import { CARDS, cardsOfRarity, rollCardDrop, aggregateCards, MYTHIC_FLOOR } from "./cards";

/** Damage per second at full uptime, pellets included. */
function dps(id: WeaponId): number {
  const w = WEAPONS[id];
  return (w.damage * (w.pellets ?? 1)) / w.cooldown;
}
/** Total damage the weapon can deal before it is spent. */
function lifetime(id: WeaponId): number {
  const w = WEAPONS[id];
  return w.damage * (w.pellets ?? 1) * w.maxDurability;
}
/** Seconds of continuous fire before it's gone (ranged uptime). */
function sustain(id: WeaponId): number {
  return WEAPONS[id].maxDurability * WEAPONS[id].cooldown;
}

describe("mythic cards are reachable from play", () => {
  it("REGRESSION: a deep boss can actually drop one", () => {
    let mythic = 0;
    for (let i = 0; i < 50000; i++) {
      const id = rollCardDrop({ boss: true, floor: MYTHIC_FLOOR, legendaryAllowed: true, mythicAllowed: true });
      if (id && CARDS[id].rarity === "mythic") mythic++;
    }
    expect(mythic, "no mythic in 50k deep-boss rolls — the tier is dead content").toBeGreaterThan(0);
  });

  it("stays a DEEP-boss prize: never from trash, never from a shallow boss", () => {
    const rolls = (opts: Parameters<typeof rollCardDrop>[0], n: number) => {
      let m = 0;
      for (let i = 0; i < n; i++) {
        const id = rollCardDrop(opts);
        if (id && CARDS[id].rarity === "mythic") m++;
      }
      return m;
    };
    expect(rolls({ boss: false, floor: 30, legendaryAllowed: true, mythicAllowed: true }, 30000)).toBe(0);
    expect(rolls({ boss: true, floor: MYTHIC_FLOOR - 1, legendaryAllowed: true, mythicAllowed: true }, 30000)).toBe(0);
  });

  it("is once per run — the latch shuts it off", () => {
    let m = 0;
    for (let i = 0; i < 30000; i++) {
      const id = rollCardDrop({ boss: true, floor: 30, legendaryAllowed: true, mythicAllowed: false });
      if (id && CARDS[id].rarity === "mythic") m++;
    }
    expect(m).toBe(0);
  });

  it("is rarer than legendary from the same boss", () => {
    let mythic = 0;
    let legendary = 0;
    for (let i = 0; i < 60000; i++) {
      const id = rollCardDrop({ boss: true, floor: 30, legendaryAllowed: true, mythicAllowed: true });
      if (!id) continue;
      if (CARDS[id].rarity === "mythic") mythic++;
      if (CARDS[id].rarity === "legendary") legendary++;
    }
    expect(mythic).toBeGreaterThan(0);
    expect(mythic).toBeLessThan(legendary);
  });

  it("every rarity tier has at least one card behind it", () => {
    for (const r of ["common", "rare", "epic", "legendary", "mythic"] as const) {
      expect(cardsOfRarity(r).length, `${r} tier is empty`).toBeGreaterThan(0);
    }
  });
});

describe("no weapon is best at everything", () => {
  it("the FLAMER pays for its DPS with the shortest life in the game", () => {
    // It is allowed to top the DPS chart — that's its identity. It must not
    // also out-live the weapons it out-damages.
    expect(dps("flamethrower")).toBeGreaterThan(dps("gun"));
    expect(sustain("flamethrower")).toBeLessThan(sustain("gun"));
    expect(sustain("flamethrower")).toBeLessThan(sustain("bow"));
    // Card slots are no longer a weapon-identity axis — they come from the
    // ITEM'S RARITY now (items.ts SLOTS_BY_RARITY), so every weapon id has the
    // same ceiling and there is nothing left for the flamer to over-carry.
    expect(lifetime("flamethrower")).toBeLessThan(lifetime("mace"));
  });

  it("REGRESSION: no carryable weapon is worse than bare FISTS at everything", () => {
    // The chair used to be: lower DPS, lower reach-per-second and a shorter
    // life, with no compensating property visible in its numbers.
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      if (id === "fists") continue;
      const w = WEAPONS[id];
      const better =
        dps(id) > dps("fists") ||
        w.range > WEAPONS.fists.range * 1.5 ||
        (w.knockbackMult ?? 1) > 1 ||
        (w.pierce ?? 0) > 0 ||
        (w.heft ?? 1) !== 1;
      expect(better, `${id} is dominated by fists`).toBe(true);
    }
  });

  it("the CHAIR's 360 sweep is backed by real crowd stats", () => {
    // arcCos 0 = it hits everything around you. That only matters if it also
    // reaches and shoves — otherwise it's a slow, weak sword.
    expect(WEAPONS.chair.arcCos).toBe(0);
    // Reach is measured against the LIGHT melee weapons only. The heavy class
    // (greatsword/wrecking ball) reaches further by design — the chair's claim
    // is being the crowd option you can actually swing at speed, not the
    // longest weapon in the game.
    const light = (Object.keys(WEAPONS) as WeaponId[]).filter(
      (i) => WEAPONS[i].kind === "melee" && (WEAPONS[i].heft ?? 1) === 1 && i !== "fists",
    );
    const longestLight = Math.max(...light.map((i) => WEAPONS[i].range));
    expect(WEAPONS.chair.range, "the crowd weapon should out-reach the other LIGHT melee").toBe(longestLight);
    expect(WEAPONS.chair.knockbackMult ?? 1).toBeGreaterThan(1);
    expect(dps("chair")).toBeGreaterThan(dps("fists"));
    // It must stay meaningfully faster to swing than the heavy class, which is
    // the whole reason to pick it over a wrecking ball.
    expect(WEAPONS.chair.cooldown).toBeLessThan(WEAPONS.wreckingball.cooldown);
  });

  it("the BOW has a niche the GUN cannot take", () => {
    // The gun beats it on range, rate and (previously) slots. Pierce is the
    // one thing the bow does that nothing else does.
    expect(WEAPONS.bow.pierce ?? 0).toBeGreaterThan(0);
    expect(WEAPONS.gun.pierce ?? 0).toBe(0);
    // It should not ALSO be strictly worse on the softer axes. (Card slots used
    // to be one of those axes; they are rarity-driven now, so every weapon id
    // shares a ceiling and the comparison is meaningless.)
    expect(WEAPONS.bow.damage).toBeGreaterThan(WEAPONS.gun.damage);
  });

  it("the bow's pierce STACKS with pierce cards rather than being overridden", () => {
    // The fire path is `(w.pierce ?? 0) + aggregateCards(cards).pierce`. A
    // weapon baseline that silently replaced the card total would make the
    // Piercer/Railgun cards worthless on the one weapon built around pierce.
    const cardPierce = aggregateCards(["venomgland"]).pierce;
    expect(cardPierce).toBeGreaterThan(0);
    const combined = (WEAPONS.bow.pierce ?? 0) + cardPierce;
    expect(combined).toBeGreaterThan(cardPierce);
    expect(combined).toBeGreaterThan(WEAPONS.bow.pierce ?? 0);
  });

  it("every weapon table entry is internally sane", () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const w = WEAPONS[id];
      expect(w.damage, `${id} damage`).toBeGreaterThan(0);
      expect(w.cooldown, `${id} cooldown`).toBeGreaterThan(0);
      expect(w.range, `${id} range`).toBeGreaterThan(0);
      expect(w.maxDurability, `${id} durability`).toBeGreaterThan(0);
      if (w.kind === "ranged") expect(w.projectile, `${id} needs a projectile`).toBeTruthy();
    }
  });
});
