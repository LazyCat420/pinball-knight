/**
 * 🤝 Tavern multiplayer — presence + matchmaking, client side.
 *
 * Owns the OTHER knights in the room: their tinted sprites, floating nameplates,
 * and 15Hz-interpolated positions. Also owns the lobby state the HUD reads (the
 * roster dots, the ready flags, the party/solo countdown) and drives the ready
 * gate. Everything here is additive — with no server reachable, `initTavernNet`
 * simply does nothing and the tavern stays exactly the single-player scene it
 * was.
 *
 * The dungeon handoff is a callback: when the server forms a party (or the solo
 * timer fires), `onLaunch` is invoked with the session details and the tavern
 * core descends into the co-op run.
 */
import * as THREE from "three";
import { net } from "../../net/socket";
import { colorForSlot, type Facing, type PartyMember, type RemoteKnight } from "../../net/protocol";
import { createActorSprite, type ActorSprite } from "../dungeon/render/sprite";
import { getKnightSheet } from "../dungeon/render/knight-sheets";
import { lookFromGear } from "../dungeon/render/knight-look";
import { Animator, facingFromVelocity } from "../dungeon/render/animator";
import { state as dungeonState, activeWeapon } from "../dungeon/state";
import { getPlayerName } from "../../services/player-name";
import { SPRITE_UNITS } from "../dungeon/constants";

const MOVE_HZ = 15;
const MOVE_INTERVAL = 1 / MOVE_HZ;
/** Position lerp toward the last received pose. Higher = snappier, less smooth. */
const INTERP_RATE = 12;
const WALK_THRESHOLD = 0.4;
const NAMEPLATE_Y = SPRITE_UNITS * 1.18;

interface RemoteEntity {
  target: RemoteKnight; // last authoritative pose from the server
  sprite: ActorSprite;
  animator: Animator;
  nameplate: THREE.Mesh;
  renderX: number; // interpolated, what's drawn
  renderZ: number;
  facing: Facing;
}

/** Where the launch handoff and the HUD read lobby state from. */
export interface LaunchInfo {
  sessionId: string;
  role: number;
  members: PartyMember[];
  hostId: string;
  solo: boolean;
  seed: number;
}

interface LobbyView {
  connected: boolean;
  myId: string | null;
  mySlot: number;
  overflow: boolean;
  /** All present knights INCLUDING me, by slot presence — for the roster dots. */
  presentSlots: Set<number>;
  readySlots: Set<number>;
  iAmReady: boolean;
  /** Party or solo countdown, seconds; null when none is running. */
  countdown: number | null;
  countdownKind: "party" | "solo" | null;
}

const remotes = new Map<string, RemoteEntity>();
let scene: THREE.Scene | null = null;
let moveT = 0;
let lastSent = { x: NaN, z: NaN, facing: "S" as Facing };
let onLaunch: ((info: LaunchInfo) => void) | null = null;
const unsubs: Array<() => void> = [];

const view: LobbyView = {
  connected: false,
  myId: null,
  mySlot: -1,
  overflow: false,
  presentSlots: new Set(),
  readySlots: new Set(),
  iAmReady: false,
  countdown: null,
  countdownKind: null,
};

export function lobbyView(): Readonly<LobbyView> {
  return view;
}
export function isMultiplayerActive(): boolean {
  return view.connected;
}

// ── Nameplate ─────────────────────────────────────────────────────────────────
function makeNameplate(name: string, hex: number): THREE.Mesh {
  const pad = 6;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = "16px 'Press Start 2P', monospace";
  const text = name.toUpperCase().slice(0, 12);
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
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
  const aspect = w / 24;
  const h = 0.28;
  const geo = new THREE.PlaneGeometry(h * aspect, h);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = NAMEPLATE_Y;
  mesh.renderOrder = 20;
  return mesh;
}

// ── Remote lifecycle ──────────────────────────────────────────────────────────
function addRemote(k: RemoteKnight): void {
  if (!scene || k.id === view.myId || remotes.has(k.id)) return;
  const sheet = getKnightSheet(activeWeapon().id, lookFromGear(dungeonState.gear), "tavern");
  const sprite = createActorSprite(sheet, false);
  const color = colorForSlot(k.slot);
  sprite.setTint(color.hex);
  const animator = new Animator(sprite);
  animator.setFacing(k.facing);
  const nameplate = makeNameplate(k.name, color.hex);
  sprite.mesh.add(nameplate);
  sprite.mesh.position.set(k.x, 0, k.z);
  scene.add(sprite.mesh);
  remotes.set(k.id, { target: { ...k }, sprite, animator, nameplate, renderX: k.x, renderZ: k.z, facing: k.facing });
  view.presentSlots.add(k.slot);
  if (k.ready) view.readySlots.add(k.slot);
}

function removeRemote(id: string): void {
  const r = remotes.get(id);
  if (!r) return;
  view.presentSlots.delete(r.target.slot);
  view.readySlots.delete(r.target.slot);
  r.sprite.mesh.remove(r.nameplate);
  (r.nameplate.geometry as THREE.BufferGeometry).dispose();
  const nm = r.nameplate.material as THREE.MeshBasicMaterial;
  nm.map?.dispose();
  nm.dispose();
  r.sprite.mesh.removeFromParent();
  r.sprite.dispose();
  remotes.delete(id);
}

function clearRemotes(): void {
  for (const id of [...remotes.keys()]) removeRemote(id);
}

// ── Wire the socket ───────────────────────────────────────────────────────────
/**
 * Connect and start presence for this tavern visit. `launch` fires when the
 * server hands us into a dungeon session. No-op (returns false) when the backend
 * isn't reachable — the caller stays single-player.
 */
export function initTavernNet(s: THREE.Scene, launch: (info: LaunchInfo) => void): boolean {
  scene = s;
  onLaunch = launch;
  moveT = 0;
  lastSent = { x: NaN, z: NaN, facing: "S" };
  resetView();

  const client = net();
  const preferredSlot = readSavedSlot();

  const started = client.connect(() => {
    // (re)connect: announce ourselves. On a reconnect this re-establishes
    // presence; the server treats a repeat hello as idempotent per connection.
    client.send({ type: "hello", name: getPlayerName(), preferredSlot });
  });
  if (!started) return false;

  unsubs.push(client.onStatus((st) => (view.connected = st === "open")));
  unsubs.push(
    client.on("welcome", (m) => {
      view.myId = m.id;
      view.mySlot = m.slot;
      view.overflow = m.slot < 0;
      if (m.slot >= 0) {
        view.presentSlots.add(m.slot);
        saveSlot(m.slot);
      }
    }),
  );
  unsubs.push(client.on("room:full", () => (view.overflow = true)));
  unsubs.push(
    client.on("room:state", (m) => {
      clearRemotes();
      for (const p of m.players) addRemote(p);
    }),
  );
  unsubs.push(client.on("player:join", (m) => addRemote(m.player)));
  unsubs.push(client.on("player:leave", (m) => removeRemote(m.id)));
  unsubs.push(
    client.on("player:move", (m) => {
      const r = remotes.get(m.id);
      if (!r) return;
      r.target.x = m.x;
      r.target.z = m.z;
      r.target.facing = m.facing;
    }),
  );
  unsubs.push(
    client.on("player:ready", (m) => {
      const r = remotes.get(m.id);
      const slot = r ? r.target.slot : m.id === view.myId ? view.mySlot : -1;
      if (r) r.target.ready = m.ready;
      if (slot >= 0) {
        if (m.ready) view.readySlots.add(slot);
        else view.readySlots.delete(slot);
      }
    }),
  );

  // Countdowns
  unsubs.push(
    client.on("party:forming", (m) => {
      view.countdown = m.seconds;
      view.countdownKind = "party";
    }),
  );
  unsubs.push(
    client.on("party:tick", (m) => {
      view.countdown = m.seconds;
      view.countdownKind = "party";
    }),
  );
  unsubs.push(
    client.on("party:cancelled", () => {
      view.countdown = null;
      view.countdownKind = null;
    }),
  );
  unsubs.push(
    client.on("solo:countdown", (m) => {
      view.countdown = m.seconds;
      view.countdownKind = "solo";
    }),
  );

  // Launch into the dungeon
  unsubs.push(
    client.on("party:start", (m) => {
      onLaunch?.({ sessionId: m.sessionId, role: m.role, members: m.members, hostId: m.hostId, solo: false, seed: m.seed });
    }),
  );
  unsubs.push(
    client.on("solo:start", (m) => {
      onLaunch?.({ sessionId: m.sessionId, role: 0, members: [], hostId: view.myId ?? "", solo: true, seed: m.seed });
    }),
  );

  return true;
}

/** Tear presence down for this visit (keeps the shared socket alive if a party
 *  is launching, so the session channel survives the scene change). */
export function disposeTavernNet(keepSocket: boolean): void {
  for (const u of unsubs) u();
  unsubs.length = 0;
  clearRemotes();
  scene = null;
  onLaunch = null;
  if (!keepSocket) net().close();
  resetView();
}

function resetView(): void {
  view.connected = net().connected;
  view.myId = net().id;
  view.mySlot = -1;
  view.overflow = false;
  view.presentSlots = new Set();
  view.readySlots = new Set();
  view.iAmReady = false;
  view.countdown = null;
  view.countdownKind = null;
}

// ── Per-frame: broadcast local pose + interpolate remotes ─────────────────────
export function broadcastLocal(dt: number, x: number, z: number, facing: Facing): void {
  if (!view.connected) return;
  moveT -= dt;
  if (moveT > 0) return;
  moveT = MOVE_INTERVAL;
  // Skip identical frames — a knight standing still shouldn't spam the wire.
  if (x === lastSent.x && z === lastSent.z && facing === lastSent.facing) return;
  lastSent = { x, z, facing };
  net().send({ type: "move", x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, facing });
}

export function updateRemotes(dt: number): void {
  const k = Math.min(1, dt * INTERP_RATE);
  for (const r of remotes.values()) {
    const px = r.renderX;
    const pz = r.renderZ;
    r.renderX += (r.target.x - r.renderX) * k;
    r.renderZ += (r.target.z - r.renderZ) * k;
    const vx = (r.renderX - px) / (dt || 1 / 60);
    const vz = (r.renderZ - pz) / (dt || 1 / 60);
    const speed = Math.hypot(vx, vz);
    if (speed > WALK_THRESHOLD) {
      r.facing = facingFromVelocity(vx, vz, r.facing);
      r.animator.setFacing(r.facing);
      r.animator.play("walk");
      r.animator.setRate(0.7 + Math.min(1.5, speed / 4.6) * 0.6);
    } else {
      r.animator.setFacing(r.target.facing);
      r.animator.play("idle");
      r.animator.setRate(1);
    }
    r.animator.update(dt);
    // No re-billboard: createActorSprite orients the mesh once against the iso
    // camera (which never rotates here), and the nameplate is a child that
    // inherits that facing. Re-applying it per frame would double the rotation.
    r.sprite.mesh.position.set(r.renderX, 0, r.renderZ);
  }
}

// ── Ready gate ────────────────────────────────────────────────────────────────
export function setLocalReady(ready: boolean): void {
  if (!view.connected || view.iAmReady === ready) return;
  view.iAmReady = ready;
  if (view.mySlot >= 0) {
    if (ready) view.readySlots.add(view.mySlot);
    else view.readySlots.delete(view.mySlot);
  }
  net().send({ type: "ready", ready });
}

// ── Preferred-slot persistence ────────────────────────────────────────────────
const SLOT_KEY = "pk-mp-slot";
function readSavedSlot(): number | undefined {
  try {
    const v = sessionStorage.getItem(SLOT_KEY);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < 8 ? n : undefined;
  } catch {
    return undefined;
  }
}
function saveSlot(slot: number): void {
  try {
    sessionStorage.setItem(SLOT_KEY, String(slot));
  } catch {
    /* private mode / disabled storage — the server still assigns a slot */
  }
}
