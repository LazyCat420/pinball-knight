/**
 * 🤝 Tavern pool presence — the hub end of the drop-in pool.
 *
 * No lobby, no ready, no party: connecting IS joining. Everyone on the site
 * shares one world; here in the tavern hub you see the pool-mates who are also in
 * the tavern. The dungeon shows its own floor-mates over the same socket
 * (`dungeon/coop.ts`), both reading the shared `net/presence` roster.
 *
 * Thin: presence owns the connection + roster (and lives for the whole session);
 * this module just renders the tavern-scene knights and publishes the local pose
 * while the hub is open. Additive — with no reachable backend `initTavernPool`
 * returns false and the tavern is exactly the single-player hub.
 */
import * as THREE from "three";
import type { Facing } from "../../net/protocol";
import { getPlayerName } from "../../services/player-name";
import { startPresence, sendPose, setLocalScene, peers, onlineCount, isConnected } from "../../net/presence";
import { RemotePartyRenderer } from "../dungeon/render/remote-party";

const SCENE = "tavern";

let renderer: RemotePartyRenderer | null = null;

export function isMultiplayerActive(): boolean {
  return isConnected();
}
/** Everyone in the pool right now, including you (for the hub HUD). */
export function poolOnlineCount(): number {
  return onlineCount();
}

/**
 * Join the pool and start rendering tavern-mates. No-op (returns false) when the
 * backend isn't reachable — caller stays single-player.
 */
export function initTavernPool(scene: THREE.Scene): boolean {
  if (!startPresence(getPlayerName())) return false;
  setLocalScene(SCENE);
  renderer = new RemotePartyRenderer(scene, "tavern", (s) => s === SCENE);
  return true;
}

/** Publish our pose (tagged 'tavern') + reconcile/animate tavern-mates. */
export function updateTavernPool(dt: number, x: number, z: number, facing: Facing): void {
  if (!isConnected()) return;
  sendPose(dt, x, z, facing);
  renderer?.sync(peers(), dt);
}

/** Drop the tavern's rendered knights. The shared socket stays open (the dungeon
 *  rides it) — presence is only fully torn down on a complete game exit. */
export function disposeTavernPool(): void {
  renderer?.dispose();
  renderer = null;
}
