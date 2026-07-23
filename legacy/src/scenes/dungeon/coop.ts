/**
 * 🤝 Co-op dungeon presence — the dungeon end of the drop-in pool.
 *
 * Same socket + roster as the tavern hub (`net/presence`), just rendered into the
 * dungeon scene and filtered to the player's CURRENT FLOOR. Because the whole
 * pool shares one world seed (handed out in `welcome`), every player generates
 * the identical maze/enemy/boss layout — so seeing a pool-mate on "floor 2" means
 * you're both genuinely on the same floor 2.
 *
 * SCOPE: pose-synced. Each client runs its OWN sim off the shared seed, so you
 * spawn on the identical floor + boss and SEE each other, but enemy/boss HP can
 * drift over a long fight (each kills its own instance). `isReplica()` is false;
 * host-authoritative enemy/boss streaming is the documented next step.
 * No-op with no reachable backend (solo/offline plays exactly as before).
 */
import { peers, sendPose, setLocalScene, isConnected, poolSeed } from "../../net/presence";
import { state } from "./state";
import { RemotePartyRenderer } from "./render/remote-party";

let renderer: RemotePartyRenderer | null = null;
let floor = 1;

function sceneTag(level: number): string {
  return `dungeon:${level}`;
}

/** True when the shared world owns enemy/boss state and this client should
 *  suppress its own sim. Always false this pass (every client simulates locally
 *  off the shared seed); the hook keeps the boss/enemy gates forward-compatible. */
export function isReplica(): boolean {
  return false;
}
export function isCoop(): boolean {
  return isConnected();
}
/** The shared world seed, or null when not in the pool. */
export function coopSeed(): number | null {
  return isConnected() ? poolSeed() : null;
}

/**
 * Begin co-op rendering for the run. The connection + roster already exist
 * (opened by the tavern hub); this just spins up the dungeon-scene renderer.
 * No-op when offline. Call once as the run starts.
 */
export function initCoop(): void {
  if (!isConnected() || !state.scene) return;
  floor = state.level || 1;
  setLocalScene(sceneTag(floor));
  renderer = new RemotePartyRenderer(state.scene, "dungeon", (s) => s === sceneTag(floor));
}

/** Update the floor tag as the player descends so peers filter to the new floor. */
export function setCoopFloor(level: number): void {
  floor = level;
  if (isConnected()) setLocalScene(sceneTag(floor));
}

/** Publish our pose (tagged with the floor) + reconcile/animate floor-mates. */
export function updateCoop(dt: number): void {
  if (!renderer || !isConnected()) return;
  const p = state.player;
  if (p) sendPose(dt, p.x, p.z, p.facing);
  renderer.sync(peers(), dt);
}

/** Drop the dungeon's rendered knights. Leaves the shared socket open. */
export function endCoop(): void {
  renderer?.dispose();
  renderer = null;
}
