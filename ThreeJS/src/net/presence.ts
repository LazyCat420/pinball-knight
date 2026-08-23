/**
 * 👥 Pool presence — the one persistent registry of who's in the shared world.
 *
 * Installs its socket subscriptions ONCE and keeps them for the whole game
 * session, so the roster (id → color/name/scene/pose) survives the tavern↔dungeon
 * hand-off. Both the tavern hub and the dungeon render from `peers()`, each
 * filtering to its own scene — that's why a pool-mate who was already online
 * before you descended still shows up with the right color and name.
 *
 * The local knight publishes its pose here too: set the scene once per screen
 * (`setLocalScene`) and call `sendPose` each frame (throttled to 15Hz).
 */
import { net } from "./socket";
import type { Facing } from "./protocol";
import type { NetStatus } from "./socket";

export interface PeerInfo {
  id: string;
  slot: number;
  name: string;
  scene: string;
  x: number;
  z: number;
  facing: Facing;
  /** The knight's current animation clip ("walk"/"ball"/"roll"/…) so remotes
   * can mirror it — a bouncing marble must not render as a walk cycle. */
  mode: string;
}

const MOVE_HZ = 15;
const MOVE_INTERVAL = 1 / MOVE_HZ;

const roster = new Map<string, PeerInfo>();
let installed = false;
let localScene = "tavern";
let moveT = 0;
let lastSent = { x: NaN, z: NaN, f: "S" as Facing, m: "" };

/**
 * ARRIVAL / DEPARTURE listeners.
 *
 * Presence is the only layer that sees join and leave, but it is deliberately
 * scene-agnostic — it must not import the tavern or the dungeon (both import
 * IT). So it publishes, and whichever scene is mounted subscribes. Listeners
 * are keyed so a scene re-entering replaces its own hook instead of stacking a
 * second copy on every descend.
 *
 * The leave payload carries the peer's LAST KNOWN position: the server's
 * `player:leave` is `{id}` only, and by the time a listener runs the roster
 * entry is gone, so it is read out here while it still exists. That position is
 * what the dungeon detonates.
 */
export interface PeerArrival {
  id: string;
  name: string;
  scene: string;
}
export interface PeerDeparture {
  id: string;
  name: string;
  /** The scene they were in when last seen — a hole belongs on THAT floor. */
  scene: string;
  x: number;
  z: number;
}
type ArriveFn = (p: PeerArrival) => void;
type DepartFn = (p: PeerDeparture) => void;
const arriveListeners = new Map<string, ArriveFn>();
const departListeners = new Map<string, DepartFn>();
/** Peers we have already greeted this session — see the join handler for why a
 *  plain "did the roster have them" check is not enough. */
const seenPeers = new Set<string>();

/** Subscribe to pool arrivals under `key` (replaces any previous hook of that
 *  key). Pass null to unsubscribe — scenes do this on teardown. */
export function onPeerArrive(key: string, fn: ArriveFn | null): void {
  if (fn) arriveListeners.set(key, fn);
  else arriveListeners.delete(key);
}
/** Subscribe to pool departures under `key`. Same contract as onPeerArrive. */
export function onPeerDepart(key: string, fn: DepartFn | null): void {
  if (fn) departListeners.set(key, fn);
  else departListeners.delete(key);
}

/**
 * Ensure the pool connection + subscriptions exist. Idempotent: the socket is a
 * singleton and the subs install once. `name` is sent on (re)connect. Returns
 * false when the backend isn't reachable (caller stays single-player).
 */
export function startPresence(name: string): boolean {
  const c = net();
  // Already wired — never call connect() twice (it would open a 2nd socket). The
  // onOpen hook set on the first connect re-sends hello on every reconnect.
  if (installed) return c.connected;

  const started = c.connect(() => {
    roster.clear();
    c.send({ type: "hello", name });
  });
  if (!started) return false;
  installed = true;

  c.on("room:state", (m) => {
    roster.clear();
    for (const p of m.players) {
      roster.set(p.id, { id: p.id, slot: p.slot, name: p.name, scene: p.scene, x: p.x, z: p.z, facing: p.facing, mode: p.mode ?? "idle" });
      // Everyone already online counts as "seen" WITHOUT announcing. room:state
      // arrives on OUR connect, so announcing here would greet the whole pool
      // the instant we log in — and after a reconnect it would do it again.
      seenPeers.add(p.id);
    }
  });
  c.on("player:join", (m) => {
    const p = m.player;
    roster.set(p.id, { id: p.id, slot: p.slot, name: p.name, scene: p.scene, x: p.x, z: p.z, facing: p.facing, mode: p.mode ?? "idle" });
    // Announce only a peer we have never seen this session. A flapping socket
    // reconnects with backoff and re-emits joins for people already in the pool;
    // without this the pool would "arrive" over and over.
    if (!seenPeers.has(p.id)) {
      seenPeers.add(p.id);
      // Name comes off the JOIN PAYLOAD, never the roster: a peer learned via
      // movement first is stored under the placeholder "KNIGHT".
      const arrival: PeerArrival = { id: p.id, name: p.name, scene: p.scene };
      for (const fn of arriveListeners.values()) fn(arrival);
    }
  });
  c.on("player:leave", (m) => {
    // Read the last-known pose BEFORE dropping it — the server's leave payload
    // is `{id}` alone, and this is the only record of where they fell.
    const last = roster.get(m.id);
    roster.delete(m.id);
    seenPeers.delete(m.id); // a genuine re-join later should announce again
    if (!last) return;
    const departure: PeerDeparture = { id: m.id, name: last.name, scene: last.scene, x: last.x, z: last.z };
    for (const fn of departListeners.values()) fn(departure);
  });
  c.on("player:move", (m) => {
    const e = roster.get(m.id);
    if (e) {
      e.x = m.x;
      e.z = m.z;
      e.facing = m.facing;
      e.scene = m.scene;
      e.mode = m.mode ?? "idle";
    } else {
      // Learned via movement before a join/snapshot — fill what we can; the next
      // room:state/join corrects color+name.
      roster.set(m.id, { id: m.id, slot: 0, name: "KNIGHT", scene: m.scene, x: m.x, z: m.z, facing: m.facing, mode: m.mode ?? "idle" });
    }
  });
  return true;
}

export function isConnected(): boolean {
  return net().connected;
}
export function myId(): string | null {
  return net().id;
}
export function poolSeed(): number | null {
  return net().seed;
}
/** Raw socket status — lets a caller tell "still connecting" from "gave up",
 *  which `isConnected()` (open-only) collapses into a single false. */
export function poolStatus(): NetStatus {
  return net().status;
}
/** Everyone in the pool including you. */
export function onlineCount(): number {
  return net().connected ? roster.size + 1 : 0;
}

/** All OTHER pool members (self excluded). */
export function peers(): PeerInfo[] {
  const me = net().id;
  const out: PeerInfo[] = [];
  for (const p of roster.values()) if (p.id !== me) out.push(p);
  return out;
}

/** Set which scene the local knight is in ("tavern" | "dungeon:<floor>"). */
export function setLocalScene(scene: string): void {
  localScene = scene;
  lastSent = { x: NaN, z: NaN, f: "S", m: "" }; // force a resend under the new scene tag
}

/** Publish the local pose (throttled). Tagged with the current local scene and
 * the knight's current animation clip so remotes can mirror it. */
export function sendPose(dt: number, x: number, z: number, facing: Facing, mode = "idle"): void {
  if (!net().connected) return;
  moveT -= dt;
  if (moveT > 0) return;
  moveT = MOVE_INTERVAL;
  if (x === lastSent.x && z === lastSent.z && facing === lastSent.f && mode === lastSent.m) return;
  lastSent = { x, z, f: facing, m: mode };
  net().send({ type: "move", x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, facing, scene: localScene, mode });
}

/** Full teardown — closes the socket. Only on a complete game exit. */
export function stopPresence(): void {
  roster.clear();
  seenPeers.clear();
  arriveListeners.clear();
  departListeners.clear();
  installed = false;
  net().close();
}
