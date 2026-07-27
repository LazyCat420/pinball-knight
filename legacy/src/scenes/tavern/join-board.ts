/**
 * 🪧 THE JOIN BOARD — "who's down there", and a way to go with them.
 *
 * WHAT IT IS NOW. Descending itself rallies you onto the pool's floor
 * (`net/rally.ts`), so this board is no longer the only road to co-op — it is
 * the OVERRIDE: it shows every occupied floor and lets you pick a different one
 * (a friend who split off, the depth your corpse is on) in one click.
 *
 * The board used to carry the whole co-op story, and that was the bug: joining
 * was opt-in and easy to miss, so two players who entered one after the other
 * each took the plunger to their own resume depth and played two private worlds
 * — the server relays world/act to same-scene peers only (`dungeon:<n>`).
 *
 * Floors at or below your best depth are marked SAFE (you have survived them);
 * deeper ones are marked and still clickable, because "you'll probably die" is
 * the player's call to make, not ours — and a knight who drops in deep is
 * scaled to the depth on arrival (`game/pinball-knight/delve.ts`).
 */

import type { PeerInfo } from "../../net/presence";
import { floorOfScene } from "../../net/rally";

export { floorOfScene };

export interface FloorGroup {
  floor: number;
  /** Display names of the knights on that floor, join order. */
  names: string[];
  /** True when the viewer has already reached this depth — no warning shown. */
  safe: boolean;
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
