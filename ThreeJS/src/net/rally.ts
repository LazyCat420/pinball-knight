/**
 * 🧲 RALLY — where the pool has gathered, and therefore where you land.
 *
 * THE BUG THIS EXISTS TO KILL. Descending used to be PERSONAL: the plunger sent
 * you to your own resume floor (where your corpse is) and the only way to end up
 * with someone else was to spot the small join board and click their row. So two
 * players who entered one after the other — the normal case — each dropped onto
 * their own depth. The server relays world/act to SAME-SCENE peers only
 * (`dungeon:<n>`), so two knights on two floors are two private games: no shared
 * enemies, no shared loot, no scaled boss. Every co-op feature was live and
 * almost never fired.
 *
 * THE RULE NOW. There is one pool and one destination: the floor the pool is
 * standing on. `rallyFloor` picks it — most knights wins, ties break SHALLOWEST.
 * Nobody down there yet? You take your own resume floor and become the rally
 * point for whoever descends next.
 *
 * WHY THAT RULE IS SAFE AGAINST PING-PONG. The answer is a pure function of the
 * roster, and every client counts the SAME knights — including itself, via
 * `myFloor`. So two players who descend in the same instant (before either has
 * appeared in the other's roster) compute the identical table a moment later and
 * converge on one floor instead of swapping places forever. That is the same
 * trick the floor-authority election uses: one deterministic rule, no
 * negotiation, no messages.
 *
 * Dropping onto floor 12 with a floor-1 knight is survivable because the delve
 * catch-up (`game/pinball-knight/delve.ts`) scales the arriving knight to the
 * depth. Rally decides WHERE; delve decides how strong you get there.
 */
import type { PeerInfo } from "./presence";
import { applyFloorLock } from "../game/pinball-knight/dev/floor-lock";

/** Parse the `dungeon:<n>` scene tag. Returns 0 for the tavern or a bad tag. */
export function floorOfScene(scene: string): number {
  if (!scene?.startsWith("dungeon:")) return 0;
  const n = Number.parseInt(scene.slice("dungeon:".length), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface FloorPop {
  floor: number;
  /** How many knights are on it, INCLUDING you when it is your floor. */
  count: number;
  /** Display names of the OTHER knights there (join order). */
  names: string[];
}

/**
 * Population per occupied floor, shallowest first.
 *
 * `myFloor` is the floor the caller is on (0 = tavern / not in a dungeon). It is
 * counted, and that is load-bearing: a viewpoint-dependent count would let two
 * lone knights each see "more company over there" and trade places forever.
 */
export function poolFloors(peers: PeerInfo[], myFloor = 0): FloorPop[] {
  const byFloor = new Map<number, FloorPop>();
  const bucket = (floor: number): FloorPop => {
    let b = byFloor.get(floor);
    if (!b) {
      b = { floor, count: 0, names: [] };
      byFloor.set(floor, b);
    }
    return b;
  };
  if (myFloor > 0) bucket(myFloor).count++;
  for (const p of peers) {
    const f = floorOfScene(p.scene);
    if (f === 0) continue; // still in the tavern — not somewhere you can join
    const b = bucket(f);
    b.count++;
    b.names.push(p.name);
  }
  return [...byFloor.values()].sort((a, b) => a.floor - b.floor);
}

/**
 * The floor the pool has gathered on: most knights, ties broken SHALLOWEST.
 *
 * Shallowest-on-a-tie is not arbitrary — it is the forgiving direction. When two
 * knights land apart and have to agree, meeting on the shallower floor asks less
 * of the weaker kit than meeting on the deeper one.
 *
 * Returns null when the whole pool is in the tavern.
 */
export function rallyFloor(peers: PeerInfo[], myFloor = 0): FloorPop | null {
  let best: FloorPop | null = null;
  for (const f of poolFloors(peers, myFloor)) {
    if (!best || f.count > best.count) best = f; // list is shallowest-first, so
  } //                                              a tie keeps the earlier (shallower) one
  return best;
}

/**
 * Where the plunger drops you.
 *
 * Priority: an explicit pick (a join-board row) → the pool's rally floor → your
 * own resume floor → the top. `explicit` exists so clicking a specific floor
 * still means that floor; everything else funnels the pool together.
 */
export function resolveDescendFloor(peers: PeerInfo[], resumeFloor = 0, explicit?: number): number {
  // The dev floor lock clamps the RESULT rather than short-circuiting, so with
  // the flag off (the default, and always in production) this function behaves
  // exactly as it always has and the rally logic below is untouched.
  return applyFloorLock(resolveDescendFloorRaw(peers, resumeFloor, explicit));
}

function resolveDescendFloorRaw(peers: PeerInfo[], resumeFloor: number, explicit?: number): number {
  if (explicit && explicit > 0) return explicit;
  const rally = rallyFloor(peers, 0);
  if (rally) return rally.floor;
  return resumeFloor > 0 ? resumeFloor : 1;
}

/**
 * Post-descent reconciliation: the floor we should MOVE to, or null to stay.
 *
 * Two players who pull the plunger in the same instant both resolve against a
 * roster that does not know about the other yet, so they can land apart. A
 * moment later both rosters agree, both run this, and — because `rallyFloor`
 * counts the caller's own floor — they agree on the same answer, so exactly one
 * of them moves. Only ever called inside the short grace window right after
 * descending (see core.ts `regroupWithPoolWhenTheyLand`); nobody is ever yanked
 * off a floor they have started fighting on.
 */
export function regroupTarget(peers: PeerInfo[], myFloor: number): number | null {
  const rally = rallyFloor(peers, myFloor);
  if (!rally || rally.floor === myFloor) return null;
  return rally.floor;
}
