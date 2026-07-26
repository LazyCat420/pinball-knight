/**
 * Ground-item substrate — the one funnel every item on the floor is removed
 * through, plus the runtime drop-id sequence.
 *
 * Extracted verbatim from core.ts. This is deliberately the LOWEST layer of the
 * economy: coins, loot drops and pickups all remove items through
 * `removeGroundItem`, so it cannot live in any one of them.
 */
import { state } from "../state";
import { clearPile } from "../corpse-run";
import { coopItemTaken } from "../coop";

/** Runtime-drop network-id sequence (cards/potions/materials the authority
 * rolls mid-floor). Reset per floor beside zombieNidSeq. */
let itemNidSeq = 0;

/** Next runtime drop id. Bumped per drop; `resetItemNid()` zeroes it per floor. */
export function nextItemNid(): string {
  return "d" + itemNidSeq++;
}

/** Per-floor reset, called beside zombieNidSeq. */
export function resetItemNid(): void {
  itemNidSeq = 0;
}

/** Pull a ground item out of the world: unparent, free its GPU resources, drop
 * it from the list. Everything that removes an item goes through this — which
 * makes it the one funnel for co-op TAKE broadcasts: picking up a shared (nid'd)
 * item tells the floor so it vanishes on every screen. */
export function removeGroundItem(k: number): void {
  const it = state.groundItems[k];
  if (!it) return;
  coopItemTaken(it); // no-op for coins/personal drops (no nid) or offline
  state.scene?.remove(it.sprite.mesh);
  it.sprite.dispose();
  state.groundItems.splice(k, 1);
  // A corpse pile is only DONE when its last item is off the floor. Clearing it
  // on the first pickup would strand the rest on a refresh; clearing it here
  // means an interrupted recovery (you grabbed the sword, then died again)
  // leaves the remainder recoverable, which is the whole promise.
  if (it.corpseId && !state.groundItems.some((g) => g.corpseId === it.corpseId)) {
    clearPile(it.corpseId);
  }
}
