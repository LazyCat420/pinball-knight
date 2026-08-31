/**
 * LIGHT PUZZLE authoring (pure) — where the braziers and the sealed loot vault
 * go on a floor.
 *
 * The floor gets a **sealed vault** (a glowing chest in an open spot, far from
 * the start) and N unlit **braziers** scattered across the reachable floor.
 * Rolling the pinball knight over each brazier lights it; the last one opens the
 * vault (see dungeon/lamp-puzzle.ts for the runtime + reward). This module only
 * picks TILES — it never touches THREE or state — so it is fully unit-testable.
 *
 * Invariant-safe: it only READS the grid and only ever places things on
 * existing reachable FLOOR tiles (the vault is a chest, not a carved sealed
 * room — the "every floor tile reachable" pipeline invariant is untouched).
 */
import { type Grid, type TilePos, T_FLOOR, at, idx } from "./generator";
import type { PinballPartSpot } from "./decorate";
import { bfsDistances, bfsDistancesOwned } from "../engine/flow-field";

export interface LampPuzzlePlan {
  /** Brazier spots (already PinballPartSpots so they inject into plan.parts). */
  lamps: PinballPartSpot[];
  /** The sealed chest tile. */
  vault: TilePos;
  /** Potion ids paid out when the vault opens (see items.ts POTIONS). */
  loot: string[];
}

/**
 * Loot tables — all POTION ids (ground items spawn as kind:"potion").
 *
 * Exported so `potion-supply.test.ts` can count this as a supply route: a vault
 * payout is a real way to obtain a potion, and a guard that only knew about the
 * floor pool and the shops would call these ids unreachable.
 */
export const LOOT_TABLES: readonly (readonly string[])[] = [
  ["gold", "gold", "health"],
  ["gold", "shield", "health"],
  ["gold", "haste", "gold"],
  ["rage", "gold", "health"],
  ["gold", "ballform", "health"],
];

/** How many braziers a floor of this size/depth gets (3-5). */
export function lampCountFor(level: number): number {
  return Math.max(3, Math.min(5, 3 + Math.floor(level / 3)));
}

/**
 * Pick the puzzle's tiles, or null if the floor is too small / too crowded to
 * host one cleanly. `occupied(i,j)` reports tiles already carrying placed
 * content (parts, spawns, items, props, torches, stairs, start) — nothing
 * lands on top of them. When `bossSpot` is provided, the vault is sited
 * immediately adjacent to the boss in the boss chamber.
 */
export function authorLampPuzzle(
  g: Grid,
  start: TilePos,
  occupied: (i: number, j: number) => boolean,
  rng: () => number,
  lampCount: number,
  bossSpot?: TilePos | null,
): LampPuzzlePlan | null {
  const d = bfsDistancesOwned(g, start.i, start.j); // held while placing
  let maxD = 0;
  for (let k = 0; k < d.length; k++) if (d[k] > maxD) maxD = d[k];
  if (maxD < 8) return null; // too small to bother

  // Reachable, unoccupied floor with a little breathing room from the start.
  const cand: Array<{ i: number; j: number; d: number }> = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (at(g, i, j) !== T_FLOOR) continue;
      const dd = d[idx(g, i, j)];
      if (dd < 4) continue;
      if (occupied(i, j)) continue;
      cand.push({ i, j, d: dd });
    }
  }
  if (cand.length === 0) return null;

  // Vault: an open tile (all four cardinals floor → reads as a chamber, not
  // a wall nook).
  const openTile = (t: { i: number; j: number }): boolean =>
    at(g, t.i + 1, t.j) === T_FLOOR &&
    at(g, t.i - 1, t.j) === T_FLOOR &&
    at(g, t.i, t.j + 1) === T_FLOOR &&
    at(g, t.i, t.j - 1) === T_FLOOR;

  let vault: TilePos;
  if (bossSpot) {
    // When bossSpot is specified, site the vault right in the boss chamber.
    const bossCand = cand.slice().sort((a, b) => {
      const da = Math.abs(a.i - bossSpot.i) + Math.abs(a.j - bossSpot.j);
      const db = Math.abs(b.i - bossSpot.i) + Math.abs(b.j - bossSpot.j);
      return da - db;
    });
    // Prefer an open tile within 1..3 tiles of the boss, or the closest candidate.
    const closeOpen = bossCand.find((c) => {
      const dist = Math.abs(c.i - bossSpot.i) + Math.abs(c.j - bossSpot.j);
      return dist >= 1 && dist <= 3 && openTile(c);
    });
    const best = closeOpen ?? bossCand[0];
    vault = { i: best.i, j: best.j };
  } else {
    // Fallback: a far, open tile.
    const far = cand.filter((c) => c.d >= maxD * 0.5).sort((a, b) => b.d - a.d);
    const vaultC = far.find(openTile) ?? far[0] ?? cand[cand.length - 1];
    vault = { i: vaultC.i, j: vaultC.j };
  }

  // Braziers: spread across the reachable floor (separation scales with size),
  // never hugging the vault or each other.
  const sep = Math.max(6, Math.floor(maxD / 6));
  const lampsT: TilePos[] = [];
  for (const c of shuffle(cand, rng)) {
    if (lampsT.length >= lampCount) break;
    if (Math.abs(c.i - vault.i) + Math.abs(c.j - vault.j) < 3) continue;
    if (bossSpot && Math.abs(c.i - bossSpot.i) + Math.abs(c.j - bossSpot.j) < 3) continue;
    if (lampsT.some((l) => Math.abs(l.i - c.i) + Math.abs(l.j - c.j) < sep)) continue;
    lampsT.push({ i: c.i, j: c.j });
  }

  const lamps = lampsT.map(
    (t): PinballPartSpot => ({ i: t.i, j: t.j, kind: "lamp", dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0 }),
  );
  const loot = [...LOOT_TABLES[Math.floor(rng() * LOOT_TABLES.length)]];
  return { lamps, vault, loot };
}

function shuffle<T>(a: readonly T[], rng: () => number): T[] {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
