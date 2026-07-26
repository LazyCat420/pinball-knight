/**
 * 🪧 THE JOIN BOARD — "who's down there", and a way to go with them.
 *
 * THE PROBLEM IT SOLVES. Once players resume at their own last-died floor, the
 * pool fragments: eight knights at eight depths are eight private worlds,
 * because the server relays world/act to same-scene peers only (`dungeon:<n>`).
 * All the co-op that already works — scaled boss HP, shared loot, the
 * marble-vs-marble jackpot — would then fire only when two people happened to
 * die at the same depth.
 *
 * The fix is NOT to force everyone onto one floor. A knight dropped on floor 15
 * with a floor-3 kit dies instantly, and under the corpse rules that strands
 * their gear somewhere they cannot survive — a dead end, not a challenge.
 *
 * So: descending is personal, joining is one click. The board lists every
 * occupied floor and lets you drop straight onto it. Floors at or below your
 * best depth are marked SAFE (you have survived them); deeper ones are marked
 * and still clickable, because "you'll probably die" is the player's call to
 * make, not ours.
 */

import type { PeerInfo } from "../../net/presence";

export interface FloorGroup {
  floor: number;
  /** Display names of the knights on that floor, join order. */
  names: string[];
  /** True when the viewer has already reached this depth — no warning shown. */
  safe: boolean;
}

/** Parse the `dungeon:<n>` scene tag. Returns 0 for the tavern or a bad tag. */
export function floorOfScene(scene: string): number {
  if (!scene?.startsWith("dungeon:")) return 0;
  const n = Number.parseInt(scene.slice("dungeon:".length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Group the pool by floor, shallowest first.
 *
 * `bestDepth` decides the SAFE flag only — it never filters. A player is always
 * allowed to follow friends past their own record; the board just tells them
 * what they are walking into.
 */
export function groupByFloor(peers: PeerInfo[], bestDepth: number): FloorGroup[] {
  const byFloor = new Map<number, string[]>();
  for (const p of peers) {
    const f = floorOfScene(p.scene);
    if (f === 0) continue; // still in the tavern — not somewhere you can join
    const names = byFloor.get(f);
    if (names) names.push(p.name);
    else byFloor.set(f, [p.name]);
  }
  return [...byFloor.entries()]
    .map(([floor, names]) => ({ floor, names, safe: floor <= bestDepth }))
    .sort((a, b) => a.floor - b.floor);
}

/** One-line summary for a floor row: "Cobalt & Sage" / "Cobalt +3". */
export function describeParty(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} +${names.length - 1}`;
}
