/**
 * FLOOR LOCK — a dev switch that pins every descent to one floor.
 *
 * Requested 2026-07-28 while iterating on floor-1 art: the roster and boss are
 * the same on every floor, so descending teaches you nothing, and the plunger
 * kept offering the floor you last died on (corpse-run.ts RESUME_KEY). Both
 * conspire to put you on floor 5 when the thing under test is on floor 1.
 *
 * ── WHY A FLAG AND NOT A CODE CHANGE ────────────────────────────────────────
 * Deleting or gating the floor progression itself would mean testing a game
 * that is not the shipped one, and spawn gates are level-based
 * (`<NAME>_FROM_LEVEL`), so it would quietly change which monsters appear. This
 * instead intercepts the ONE funnel every descent already passes through
 * (`resolveDescendFloor` in net/rally.ts) and is:
 *
 *   · OFF by default — a fresh profile plays the real game,
 *   · persisted in localStorage, so it survives the reloads it exists to serve,
 *   · loud — it logs on every clamp, so nobody debugs a "bug" that is this flag.
 *
 * Usage:
 *   __lab.lock()      lock every descent to floor 1
 *   __lab.lock(3)     lock to floor 3
 *   __lab.unlock()    back to normal progression
 */

const KEY = "pinball-knight-dev-floor-lock";

/** Memoised so the hot descent path is not a localStorage read. */
let cached: number | null | undefined;

/** The locked floor, or null when progression is normal. */
export function floorLock(): number | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const n = Number.parseInt(raw ?? "", 10);
    cached = Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    cached = null; // private mode / quota — just play normally
  }
  return cached;
}

export function setFloorLock(floor: number | null): number | null {
  cached = floor && floor > 0 ? Math.floor(floor) : null;
  try {
    if (cached === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(cached));
  } catch {
    // Not fatal — the lock is just session-only this time.
  }
  return cached;
}

/**
 * Clamp a resolved descent target through the lock.
 *
 * Called by `resolveDescendFloor` AFTER it has done its normal resolution, so
 * with the lock off this is the identity function and the multiplayer rally
 * logic is untouched.
 */
export function applyFloorLock(target: number): number {
  const lock = floorLock();
  if (lock === null || lock === target) return target;
  console.warn(`[floor-lock] descent to ${target} → ${lock} (dev flag; __lab.unlock() to clear)`);
  return lock;
}

/** Test seam — drops the memo so a fresh localStorage is re-read. */
export function __resetFloorLockCache(): void {
  cached = undefined;
}
