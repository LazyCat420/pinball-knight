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
    for (const p of m.players) roster.set(p.id, { id: p.id, slot: p.slot, name: p.name, scene: p.scene, x: p.x, z: p.z, facing: p.facing, mode: "idle" });
  });
  c.on("player:join", (m) => {
    const p = m.player;
    roster.set(p.id, { id: p.id, slot: p.slot, name: p.name, scene: p.scene, x: p.x, z: p.z, facing: p.facing, mode: "idle" });
  });
  c.on("player:leave", (m) => roster.delete(m.id));
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
  installed = false;
  net().close();
}
