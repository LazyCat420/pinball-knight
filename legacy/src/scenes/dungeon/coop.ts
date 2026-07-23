/**
 * 🤝 Co-op dungeon layer — the party in the maze.
 *
 * Bridges a formed lobby party (the `PendingSession` baton the tavern set) into
 * the dungeon run. Two things make co-op work:
 *
 *   1. SHARED SEED — the server assigns one floor seed per session; every member
 *      sets it as `state.runSeed` before the first floor builds, so all clients
 *      generate the IDENTICAL maze, enemy layout, loot, and boss placement on
 *      every floor (floors derive their RNG from runSeed ^ level).
 *   2. POSE BROADCAST — each client streams its own knight's pose at 15Hz over
 *      the session's all-to-all `session:event` channel, and renders the other
 *      members as tinted, interpolated knights. So you see each other move and
 *      fight through the same dungeon.
 *
 * SCOPE (this pass): each client runs its OWN full simulation off the shared
 * seed — enemies and the boss are simulated locally and are NOT yet
 * authoritatively synced, so their HP/positions can drift between clients over a
 * long fight. `isReplica()` therefore returns false (no client suppresses its
 * sim). The next pass makes the host authoritative for enemy/boss state and
 * flips replicas to render-from-snapshot; the boss-spawn gate in core already
 * checks `isReplica()` for that. Everything here is a no-op with no session, so
 * a solo/offline run is untouched.
 */
import * as THREE from "three";
import { net } from "../../net/socket";
import { consumePendingSession, type PendingSession } from "../../net/session";
import { colorForSlot, type Facing } from "../../net/protocol";
import { createActorSprite, type ActorSprite } from "./render/sprite";
import { getKnightSheet } from "./render/knight-sheets";
import { lookFromGear } from "./render/knight-look";
import { Animator, facingFromVelocity } from "./render/animator";
import { state, activeWeapon } from "./state";
import { SPRITE_UNITS } from "./constants";

const MOVE_HZ = 15;
const MOVE_INTERVAL = 1 / MOVE_HZ;
const INTERP_RATE = 12;
const WALK_THRESHOLD = 0.4;
const NAMEPLATE_Y = SPRITE_UNITS * 1.18;

interface PosePayload {
  k: "pose";
  x: number;
  z: number;
  f: Facing;
}

interface RemoteKnight {
  slot: number;
  name: string;
  sprite: ActorSprite;
  animator: Animator;
  nameplate: THREE.Mesh;
  tx: number;
  tz: number;
  tf: Facing;
  rx: number;
  rz: number;
  facing: Facing;
  seen: boolean; // has a pose arrived yet (else keep hidden at origin)
}

let session: PendingSession | null = null;
const members = new Map<string, { slot: number; name: string }>();
const remotes = new Map<string, RemoteKnight>();
let moveT = 0;
let lastSent = { x: NaN, z: NaN, f: "S" as Facing };
const unsubs: Array<() => void> = [];

/** True while this run is a networked co-op session with at least one peer. */
export function isCoop(): boolean {
  return session !== null && members.size > 1;
}
/**
 * True when another client owns the authoritative world and this client should
 * suppress its own enemy/boss sim. Always false in this pass (every client
 * simulates locally off the shared seed); the hook exists so the boss-spawn gate
 * and enemy loop are already correct when host-authority lands.
 */
export function isReplica(): boolean {
  return false;
}
export function coopSeed(): number | null {
  return session ? session.seed >>> 0 : null;
}

/**
 * Consume the tavern→dungeon baton and start co-op for this run. Sets the shared
 * seed on `state.runSeed` (MUST be called before the first `startLevel`) and
 * opens the session channel. Returns false for a solo/offline run (no baton).
 */
export function initCoop(): boolean {
  const s = consumePendingSession();
  session = s;
  members.clear();
  if (!s) return false;

  state.runSeed = s.seed >>> 0;
  for (const m of s.members) members.set(m.id, { slot: m.slot, name: m.name });

  net().send({ type: "session:hello", sessionId: s.sessionId });

  unsubs.push(
    net().on("session:event", (msg) => {
      const ev = msg.event as PosePayload | undefined;
      if (!ev || ev.k !== "pose" || msg.fromId === net().id) return;
      applyPose(msg.fromId, ev);
    }),
  );
  unsubs.push(net().on("session:peer-left", (m) => removeRemote(m.id)));
  unsubs.push(net().on("session:ended", () => endCoop()));
  return true;
}

/** Broadcast our pose (throttled) and advance the interpolated party knights. */
export function updateCoop(dt: number): void {
  if (!session) return;

  // Broadcast local pose — only when peers actually exist.
  const p = state.player;
  if (p && members.size > 1) {
    moveT -= dt;
    if (moveT <= 0) {
      moveT = MOVE_INTERVAL;
      const f = p.facing as Facing;
      if (p.x !== lastSent.x || p.z !== lastSent.z || f !== lastSent.f) {
        lastSent = { x: p.x, z: p.z, f };
        const ev: PosePayload = { k: "pose", x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, f };
        net().send({ type: "session:event", sessionId: session.sessionId, event: ev });
      }
    }
  }

  // Interpolate + animate remotes.
  const k = Math.min(1, dt * INTERP_RATE);
  for (const r of remotes.values()) {
    if (!r.seen) continue;
    const px = r.rx;
    const pz = r.rz;
    r.rx += (r.tx - r.rx) * k;
    r.rz += (r.tz - r.rz) * k;
    const vx = (r.rx - px) / (dt || 1 / 60);
    const vz = (r.rz - pz) / (dt || 1 / 60);
    const speed = Math.hypot(vx, vz);
    if (speed > WALK_THRESHOLD) {
      r.facing = facingFromVelocity(vx, vz, r.facing);
      r.animator.setFacing(r.facing);
      r.animator.play("walk");
      r.animator.setRate(0.7 + Math.min(1.5, speed / 4.2) * 0.6);
    } else {
      r.animator.setFacing(r.tf);
      r.animator.play("idle");
      r.animator.setRate(1);
    }
    r.animator.update(dt);
    r.sprite.mesh.position.set(r.rx, 0, r.rz);
  }
}

function applyPose(id: string, ev: PosePayload): void {
  let r = remotes.get(id);
  if (!r) {
    const created = addRemote(id);
    if (!created) return;
    r = created;
  }
  r.tx = ev.x;
  r.tz = ev.z;
  r.tf = ev.f;
  if (!r.seen) {
    r.seen = true;
    r.rx = ev.x;
    r.rz = ev.z;
    r.sprite.mesh.position.set(ev.x, 0, ev.z);
    r.sprite.mesh.visible = true;
  }
}

function addRemote(id: string): RemoteKnight | null {
  if (!state.scene) return null;
  const info = members.get(id) ?? { slot: 0, name: "KNIGHT" };
  const sheet = getKnightSheet(activeWeapon().id, lookFromGear(state.gear), "dungeon");
  const sprite = createActorSprite(sheet, false);
  const color = colorForSlot(info.slot);
  sprite.setTint(color.hex);
  sprite.mesh.visible = false; // until the first pose lands
  const animator = new Animator(sprite);
  const nameplate = makeNameplate(info.name, color.hex);
  sprite.mesh.add(nameplate);
  state.scene.add(sprite.mesh);
  const r: RemoteKnight = {
    slot: info.slot,
    name: info.name,
    sprite,
    animator,
    nameplate,
    tx: 0,
    tz: 0,
    tf: "S",
    rx: 0,
    rz: 0,
    facing: "S",
    seen: false,
  };
  remotes.set(id, r);
  return r;
}

function removeRemote(id: string): void {
  const r = remotes.get(id);
  if (!r) return;
  r.sprite.mesh.remove(r.nameplate);
  (r.nameplate.geometry as THREE.BufferGeometry).dispose();
  const nm = r.nameplate.material as THREE.MeshBasicMaterial;
  nm.map?.dispose();
  nm.dispose();
  r.sprite.mesh.removeFromParent();
  r.sprite.dispose();
  remotes.delete(id);
}

function makeNameplate(name: string, hex: number): THREE.Mesh {
  const pad = 6;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = "16px 'Press Start 2P', monospace";
  const text = name.toUpperCase().slice(0, 12);
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = 24;
  const c = canvas.getContext("2d")!;
  c.font = "16px 'Press Start 2P', monospace";
  c.textBaseline = "middle";
  c.fillStyle = "rgba(8,10,14,0.72)";
  c.fillRect(0, 0, w, 24);
  c.fillStyle = `#${(hex & 0xffffff).toString(16).padStart(6, "0")}`;
  c.fillText(text, pad, 13);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const h = 0.28;
  const geo = new THREE.PlaneGeometry(h * (w / 24), h);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = NAMEPLATE_Y;
  mesh.renderOrder = 20;
  return mesh;
}

/** End co-op: leave the session, drop the party knights. Safe to call twice. */
export function endCoop(): void {
  for (const u of unsubs) u();
  unsubs.length = 0;
  for (const id of [...remotes.keys()]) removeRemote(id);
  if (session) net().send({ type: "session:leave", sessionId: session.sessionId });
  session = null;
  members.clear();
  moveT = 0;
  lastSent = { x: NaN, z: NaN, f: "S" };
}
