/**
 * CAN THE PLAYER ACTUALLY GET IT?
 *
 * ✨ LASER was a finished mechanic that could not occur. `POTIONS.laser` was in
 * the table, `applyPotion` had a branch for it, `enterRicochetForm("laser")` was
 * implemented, palette-tuned and covered by `entities/ricochet-trail.test.ts` —
 * and the id appeared in NO supply table: not `POTION_POOL` (floor), not
 * `SHOP_STOCK` (the cart), not `POTION_STOCK` (the tavern), not `RECIPES` (the
 * Alchemist), not the lamp-puzzle reward rows. It had no `ITEM_PAINTS` entry
 * either, because nothing had ever needed to draw it.
 *
 * Every test asked "does the laser work" (yes). None asked "can anyone get one"
 * (no). This file asks the second question, for every potion, because the answer
 * is not derivable from the code that consumes it — a potion that nothing
 * supplies looks exactly like a potion that works.
 *
 * ── THE SECOND HALF IS A CRASH GUARD, NOT A COSMETIC ONE ──
 * `createStaticSprite(ITEM_PAINTS[it.id])` (spawn/floor-populate.ts) is
 * unguarded, and `ITEM_PAINTS` is an untyped object literal so tsc cannot see a
 * hole in it. An id in a supply pool with no painter therefore does not draw a
 * placeholder: `staticTexture(undefined)` throws mid-build and the floor never
 * constructs — a BLACK SCREEN with a working HUD. cel-painter.ts documents that
 * happening once already, for weapons, which is why the weapon entries are
 * generated. The potions are hand-written, so they need this instead.
 */
import { describe, expect, it } from "vitest";
import { POTIONS, POTION_IDS, type PotionId } from "./items";
import { ITEM_PAINTS } from "./render/cel-painter";
import { POTION_POOL, decorateMaze } from "./maze/decorate";
import { buildTrackFloor } from "./maze/track-floor";
import { mulberry32 } from "../../utils/rng";
import { SHOP_STOCK } from "./economy/shop";
import { POTION_STOCK } from "./economy/tavern-shop";
import { RECIPES } from "./recipes";
import { LOOT_TABLES } from "./maze/lamp-puzzle";

/** Same seeding the maze suites use, so a failure here is reproducible. */
const rngFor = (s: number): (() => number) => mulberry32((s * 2654435761) >>> 0);

/** Every route a potion can reach the player by, as a set of ids. */
function supplied(): Map<PotionId, string[]> {
  const routes = new Map<PotionId, string[]>();
  const add = (id: string, route: string): void => {
    if (!(id in POTIONS)) return;
    const pid = id as PotionId;
    routes.set(pid, [...(routes.get(pid) ?? []), route]);
  };
  for (const id of POTION_POOL) add(id, "floor");
  for (const row of SHOP_STOCK) add(row.id, "cart");
  for (const id of POTION_STOCK) add(id, "tavern");
  for (const r of Object.values(RECIPES)) add(r.output, "brew");
  for (const row of LOOT_TABLES) for (const id of row) add(id, "lamps");
  return routes;
}

describe("every potion can be obtained", () => {
  it("has at least one supply route", () => {
    const routes = supplied();
    const unreachable = POTION_IDS.filter((id) => !routes.has(id));
    expect(
      unreachable,
      `no floor drop, cart row, tavern row, recipe or lamp reward supplies: ${unreachable.join(", ")}`,
    ).toEqual([]);
  });

  it("supplies the laser, which shipped with none", () => {
    // Named explicitly rather than left to the sweep above: this is the case
    // that motivated the file, and a regression here should say so by name.
    expect(supplied().get("laser") ?? []).not.toEqual([]);
  });

  it("supplies nothing that is not a real potion", () => {
    // The reverse direction: a typo in a pool ("ballfrom") is not a type error,
    // it is a floor that quietly rolls one fewer power-up.
    for (const id of POTION_POOL) expect(POTIONS[id as PotionId], `POTION_POOL has "${id}"`).toBeDefined();
    for (const id of POTION_STOCK) expect(POTIONS[id], `POTION_STOCK has "${id}"`).toBeDefined();
  });
});

describe("the shipping floor builder actually places one", () => {
  /**
   * Supply COVERAGE (an id sitting in a pool) and supply INSTANCES (a flask on a
   * floor someone plays) are different claims, and this repo has the scar: the
   * secret-wall pass picked bands on a grid the track-first generator then threw
   * away, so the mechanic was in the table and on 0 of 22 floors. So this drives
   * the real `decorateMaze` — the same call core.ts makes — rather than
   * re-reading POTION_POOL, which is what the assertions above already do.
   *
   * The pool rolls THREE of ten per floor, so a laser is ~30% of floors: over 40
   * seeds the chance of a false failure is (0.7)^40 ≈ 1 in 5 million, and the
   * seeds are fixed anyway.
   */
  it("rolls a laser onto some floor within 40 seeds", () => {
    let laserFloors = 0;
    let potionsPlaced = 0;
    for (let s = 1; s <= 40; s++) {
      const rng = rngFor(s);
      const f = buildTrackFloor(24, 18, rng);
      if (!f) continue;
      const plan = decorateMaze(f.grid, rng, 20, 10, 20, [], {
        endpoints: { start: f.start, stairs: f.stairs },
      });
      const potions = plan.items.filter((item) => item.kind === "potion");
      potionsPlaced += potions.length;
      if (potions.some((item) => item.id === "laser")) laserFloors++;
    }
    // Anti-vacuity: if the builder placed no potions at all the laser assertion
    // below would be meaningless, and THAT is the failure mode worth naming.
    expect(potionsPlaced, "no potions placed on any floor — this test proves nothing").toBeGreaterThan(40);
    expect(laserFloors, "the laser is in POTION_POOL but reached no floor in 40 seeds").toBeGreaterThan(0);
  });
});

describe("every potion can be drawn", () => {
  it("has an ITEM_PAINTS painter, so a pool entry cannot kill the floor build", () => {
    const missing = POTION_IDS.filter((id) => typeof ITEM_PAINTS[id] !== "function");
    expect(missing, `ITEM_PAINTS has no painter for: ${missing.join(", ")}`).toEqual([]);
  });

  it("gives the laser its OWN painter, not the health flask", () => {
    // Both would pass the check above. A laser that draws as a health potion is
    // a lie on the floor, and the palette has no magenta to reach for instead —
    // see laserItem(). Comparing the painters is the cheapest way to state
    // "these are not the same sprite" without asserting pixels.
    expect(ITEM_PAINTS.laser).not.toBe(ITEM_PAINTS.health);
  });
});
