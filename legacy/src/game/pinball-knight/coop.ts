/**
 * 🤝 Co-op dungeon layer — per-floor AUTHORITY, shared enemies, shared loot.
 *
 * The drop-in pool shares one world seed, so every client generates the same
 * maze and the same initial horde. But simulation diverges the moment AI runs —
 * zombies chase whoever is local. So each floor elects ONE simulator:
 *
 *   AUTHORITY = the lexicographically-smallest peer id among everyone on the
 *   floor (me included). Deterministic, no negotiation, self-healing: when the
 *   authority leaves the floor, everyone re-derives and the next-smallest id
 *   takes over seamlessly (its ghosts are real Zombie objects — it just starts
 *   simulating them).
 *
 * The authority runs the normal sim (updateZombies, boss AI, drops) and
 * broadcasts a ~10Hz world snapshot: zombies (nid/kind/pos/hp/mode/boss), nid'd
 * ground items, boss aux (bones/slam/portal) and the exit lock. REPLICAS
 * suppress their own enemy sim and reconcile `state.zombies`/`state.groundItems`
 * against the snapshot — same objects, same renderer, positions lerped.
 *
 * Replicas still FIGHT: their hits compute damage locally (their own momentum
 * gates) and forward it as an `act` to the authority, which applies it to the
 * real HP. Deaths broadcast back as kill acts → gibs + shared kill gold on
 * every screen. Loot pickups broadcast `take` acts so an item leaves everyone's
 * floor. Boss slams/portal ride the aux snapshot; slam damage is applied by
 * each client against its OWN knight (player HP stays client-owned).
 *
 * Also here: marble-vs-marble — two knights in ball form bounce off each other
 * (each client reflects its own momentum; a standing knight hit by a rolling
 * one gets launched).
 *
 * Everything is a no-op when offline or alone — solo play is byte-identical.
 */
import { peers, sendPose, setLocalScene, isConnected, poolSeed, myId, onPeerDepart, type PeerInfo } from "../../net/presence";
import { net } from "../../net/socket";
import { state, type Zombie, type GroundItem, type EnemyKind } from "./state";
import { RemotePartyRenderer } from "./render/remote-party";
import { bossNetState, applyRemoteBossAux, updateBossReplica, adoptBoss, bossActive, disposeBoss, type BossAux } from "./boss";
import { PINBALL_MAX_SPEED } from "./constants";
import { sfxBumper } from "./sfx";

const SNAP_INTERVAL = 0.1; // authority world snapshots at 10Hz
const GHOST_LERP = 10; // replica zombie interpolation rate
const CONTACT_RANGE = 0.62; // replica-side zombie contact damage radius
const CONTACT_COOLDOWN = 1.1; // s between contact hits from the same ghost
const PLAYER_BOUNCE_R = 0.5; // marble-vs-marble contact distance

// ── Wire payloads ─────────────────────────────────────────────────────────────
interface SnapZombie {
  n: string; // nid
  k: string; // EnemyKind
  x: number;
  z: number;
  h: number; // hp
  mh?: number; // maxHp (bosses/health bars)
  m: string; // ZombieMode
  b?: 1; // boss flag
}
interface SnapItem {
  n: string;
  t: GroundItem["kind"];
  i: string; // item id
  x: number;
  z: number;
}
interface WorldSnap {
  z: SnapZombie[];
  it: SnapItem[];
  boss: BossAux | null;
  lock: boolean;
}
type Act =
  | { k: "dmg"; n: string; d: number; dx: number; dz: number; p: number }
  | { k: "kill"; n: string; x: number; z: number; kind: string; boss: boolean }
  | { k: "take"; n: string }
  // A knight left the pool and their body detonated: tear a lethal hole at
  // (x,z). Broadcast by the floor AUTHORITY only, so exactly one hole exists in
  // everyone's world — see announceHole.
  | { k: "hole"; x: number; z: number; n: string };

// ── Hooks injected by core (avoids import cycles into core.ts) ────────────────
export interface CoopHooks {
  /** Create a snapshot-driven enemy (replica side). Returns null if art missing. */
  spawnGhost(nid: string, kind: EnemyKind, x: number, z: number, boss: boolean): Zombie | null;
  /** Create a snapshot-driven ground item (replica side). */
  spawnGhostItem(nid: string, kind: GroundItem["kind"], id: string, x: number, z: number): GroundItem | null;
  /** Remove an enemy WITHOUT kill logic (it died authority-side; juice separate). */
  removeZombie(z: Zombie): void;
  /** Remove a ground item (someone else picked it up). */
  removeItem(it: GroundItem): void;
  /** Kill juice + shared gold at (x,z) for a kill that happened authority-side. */
  onRemoteKill(x: number, z: number, kind: string, boss: boolean): void;
  /** Apply forwarded replica damage on the authority's real zombie. */
  applyDamage(z: Zombie, dmg: number, dx: number, dz: number, push: number): void;
  /** Hurt the LOCAL player (replica-side contact/slam damage). */
  hurtPlayer(dmg: number, srcX: number, srcZ: number): void;
  /** Detonate a departed knight at (x,z): blast VFX + a permanent lethal hole.
   *  Runs on EVERY client (authority broadcasts, replicas mirror). */
  tearHole(x: number, z: number, name: string): void;
}
let hooks: CoopHooks | null = null;
export function setCoopHooks(h: CoopHooks): void {
  hooks = h;
}

let renderer: RemotePartyRenderer | null = null;
let floor = 1;
let snapT = 0;
const unsubs: Array<() => void> = [];
/** Ghost lerp targets by nid (replica side). */
const ghostTargets = new Map<string, { x: number; z: number }>();
let wasAuthority = true;

function sceneTag(level: number): string {
  return `dungeon:${level}`;
}
function peersOnFloor(): PeerInfo[] {
  const tag = sceneTag(floor);
  return peers().filter((p) => p.scene === tag);
}

// ── Authority election ────────────────────────────────────────────────────────
/** True when THIS client simulates the floor's enemies/boss/loot. */
export function enemyAuthorityIsMe(): boolean {
  if (!isConnected()) return true; // offline: you are your own world
  const me = myId();
  if (!me) return true;
  for (const p of peersOnFloor()) if (p.id < me) return false;
  return true;
}
/** True when another client owns the floor sim — suppress ours, render theirs. */
export function isReplica(): boolean {
  return !enemyAuthorityIsMe();
}
export function isCoop(): boolean {
  return isConnected();
}
export function coopSeed(): number | null {
  return isConnected() ? poolSeed() : null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export function initCoop(): void {
  if (!isConnected() || !state.scene) return;
  // Idempotent: a second init without an endCoop would double the world/act
  // subscriptions and apply every snapshot twice.
  endCoop();
  floor = state.level || 1;
  setLocalScene(sceneTag(floor));
  renderer = new RemotePartyRenderer(state.scene, "dungeon", (s) => s === sceneTag(floor));

  unsubs.push(
    net().on("world", (m) => {
      if (m.scene !== sceneTag(floor) || !isReplica()) return;
      applySnapshot(m.snap as WorldSnap);
    }),
  );
  unsubs.push(
    net().on("act", (m) => {
      if (m.scene !== sceneTag(floor)) return;
      handleAct(m.act as Act);
    }),
  );

  // ── A knight leaving the pool blows a hole in the floor ──
  // Only the floor AUTHORITY acts on the departure and broadcasts the result.
  // Every client sees `player:leave`, so if each spawned its own hole they would
  // disagree by a fraction of a tile (the roster's last-known pose is whatever
  // 15Hz `move` frame that client happened to receive last) — and a lethal
  // hazard that sits in a different place for each player is unplayable.
  // Authority decides, everyone mirrors.
  onPeerDepart("dungeon", (d) => {
    if (d.scene !== sceneTag(floor)) return; // they left from another floor
    if (!enemyAuthorityIsMe()) return; // a replica waits for the broadcast
    hooks?.tearHole(d.x, d.z, d.name);
    net().send({ type: "act", scene: sceneTag(floor), act: { k: "hole", x: d.x, z: d.z, n: d.name } satisfies Act });
  });
  unsubs.push(() => onPeerDepart("dungeon", null));
}

export function setCoopFloor(level: number): void {
  floor = level;
  ghostTargets.clear();
  if (isConnected()) setLocalScene(sceneTag(floor));
}

export function endCoop(): void {
  for (const u of unsubs) u();
  unsubs.length = 0;
  renderer?.dispose();
  renderer = null;
  ghostTargets.clear();
}

// ── Per-frame ─────────────────────────────────────────────────────────────────
export function updateCoop(dt: number): void {
  if (!renderer || !isConnected()) return;
  const p = state.player;
  if (p) {
    // Pose carries the CURRENT CLIP so remotes mirror ball/roll/attack instead
    // of rendering a bounce as a walk cycle.
    sendPose(dt, p.x, p.z, p.facing, p.anim.getClip());
  }
  renderer.sync(peers(), dt);

  const authority = enemyAuthorityIsMe();

  // Authority HANDOVER: the previous simulator left the floor and it's us now.
  // Our ghosts are real Zombie objects — wake them (aggro) and, if the Reaper
  // King is among them without a live boss module, adopt it so slams resume.
  if (authority && !wasAuthority) {
    ghostTargets.clear();
    for (const z of state.zombies) z.aggro = true;
    const king = state.zombies.find((z) => z.boss && z.mode !== "dead");
    if (king && !bossActive()) adoptBoss(king);
  }
  // DEMOTION: a smaller id arrived on our floor and owns it now. Drop OUR
  // authority-side boss module (frozen skulls/telegraph would linger); the new
  // authority's aux snapshot rebuilds the visuals, and its world snapshot adopts
  // our zombies by nid (both floors were seed-spawned in the same order).
  if (!authority && wasAuthority) {
    disposeBoss();
  }
  wasAuthority = authority;

  if (authority) {
    snapT -= dt;
    if (snapT <= 0 && peersOnFloor().length > 0) {
      snapT = SNAP_INTERVAL;
      net().send({ type: "world", scene: sceneTag(floor), snap: buildSnapshot() });
    }
  } else {
    ghostTick(dt);
  }

  playerCollisions();
}

// ── Authority: build the world snapshot ───────────────────────────────────────
function buildSnapshot(): WorldSnap {
  const zs: SnapZombie[] = [];
  for (const z of state.zombies) {
    if (z.mode === "dead" || !z.nid) continue;
    const s: SnapZombie = {
      n: z.nid,
      k: z.kind,
      x: Math.round(z.x * 50) / 50,
      z: Math.round(z.z * 50) / 50,
      h: Math.ceil(z.hp),
      m: z.mode,
    };
    if (z.maxHp) s.mh = z.maxHp;
    if (z.boss) s.b = 1;
    zs.push(s);
  }
  const items: SnapItem[] = [];
  for (const it of state.groundItems) {
    if (!it.nid || it.kind === "coin") continue;
    items.push({ n: it.nid, t: it.kind, i: it.id, x: it.x, z: it.z });
  }
  return { z: zs, it: items, boss: bossNetState(), lock: state.exitLocked };
}

// ── Replica: reconcile against the snapshot ───────────────────────────────────
function applySnapshot(snap: WorldSnap): void {
  if (!hooks) return;

  // Zombies: adopt matching nids, spawn missing, drop absent (died/never were).
  const byNid = new Map<string, Zombie>();
  for (const z of state.zombies) if (z.nid) byNid.set(z.nid, z);
  const live = new Set<string>();
  for (const sz of snap.z) {
    live.add(sz.n);
    let z = byNid.get(sz.n);
    if (!z) {
      z = hooks.spawnGhost(sz.n, sz.k as EnemyKind, sz.x, sz.z, !!sz.b) ?? undefined;
      if (!z) continue;
    }
    z.hp = sz.h;
    if (sz.mh) z.maxHp = sz.mh;
    z.mode = sz.m as Zombie["mode"];
    ghostTargets.set(sz.n, { x: sz.x, z: sz.z });
  }
  for (let i = state.zombies.length - 1; i >= 0; i--) {
    const z = state.zombies[i];
    if (z.nid && !live.has(z.nid) && z.mode !== "dead") {
      hooks.removeZombie(z);
      state.zombies.splice(i, 1);
      ghostTargets.delete(z.nid);
    }
  }

  // Ground items: spawn what we lack, remove nid'd items the snapshot dropped.
  const itemByNid = new Map<string, GroundItem>();
  for (const it of state.groundItems) if (it.nid) itemByNid.set(it.nid, it);
  const liveItems = new Set<string>();
  for (const si of snap.it) {
    liveItems.add(si.n);
    if (!itemByNid.has(si.n)) hooks.spawnGhostItem(si.n, si.t, si.i, si.x, si.z);
  }
  for (let i = state.groundItems.length - 1; i >= 0; i--) {
    const it = state.groundItems[i];
    if (it.nid && !liveItems.has(it.nid)) {
      hooks.removeItem(it);
      state.groundItems.splice(i, 1);
    }
  }

  // Boss aux (skulls/bones/slam/portal) + the exit lock ride the snapshot.
  applyRemoteBossAux(snap.boss);
  state.exitLocked = snap.lock;
}

/** Replica per-frame: lerp ghosts to their targets, animate, contact damage. */
function ghostTick(dt: number): void {
  updateBossReplica(dt); // skulls orbit, portal spins, telegraph pulses
  const p = state.player;
  const k = Math.min(1, dt * GHOST_LERP);
  for (const z of state.zombies) {
    if (z.mode === "dead" || !z.nid) continue;
    const t = ghostTargets.get(z.nid);
    if (t) {
      const px = z.x;
      const pz = z.z;
      z.x += (t.x - z.x) * k;
      z.z += (t.z - z.z) * k;
      const speed = Math.hypot(z.x - px, z.z - pz) / (dt || 1 / 60);
      z.anim.play(speed > 0.35 ? "walk" : "idle");
      z.anim.update(dt);
      syncGhostMesh(z);
    }
    // Contact damage against OUR knight — player HP is client-owned, so the
    // replica applies its own hits (the authority's zombies only ever hurt the
    // authority's knight in its sim).
    if (p && hooks) {
      z.cooldown = Math.max(0, (z.cooldown ?? 0) - dt);
      if (z.cooldown <= 0 && (z.mode === "windup" || z.mode === "chase" || z.mode === "charge" || z.mode === "slam")) {
        if (Math.hypot(p.x - z.x, p.z - z.z) < CONTACT_RANGE) {
          z.cooldown = CONTACT_COOLDOWN;
          hooks.hurtPlayer(z.kind === "reaper" || z.boss ? 2 : 1, z.x, z.z);
        }
      }
    }
  }
}

/** Mirror of core's syncActorMesh essentials for snapshot-driven ghosts. */
function syncGhostMesh(z: Zombie): void {
  z.sprite.mesh.position.set(z.x, z.sprite.mesh.position.y, z.z);
}

// ── Damage forwarding (called from combat.damageZombie on replicas) ───────────
export function coopForwardDamage(z: Zombie, dmg: number, dx: number, dz: number, push: number): void {
  if (!z.nid || !isConnected()) return;
  const act: Act = { k: "dmg", n: z.nid, d: Math.round(dmg * 10) / 10, dx: Math.round(dx * 100) / 100, dz: Math.round(dz * 100) / 100, p: Math.round(push * 100) / 100 };
  net().send({ type: "act", scene: sceneTag(floor), act });
}

/** Authority broadcasts a death so every screen gets gibs + shared kill gold. */
export function coopBroadcastKill(z: Zombie): void {
  if (!isConnected() || !enemyAuthorityIsMe() || !z.nid) return;
  const act: Act = { k: "kill", n: z.nid, x: z.x, z: z.z, kind: z.kind, boss: !!z.boss };
  net().send({ type: "act", scene: sceneTag(floor), act });
}

/** Any client picked up a shared item — tell the floor so it vanishes for all. */
export function coopItemTaken(it: GroundItem): void {
  if (!it.nid || !isConnected()) return;
  const act: Act = { k: "take", n: it.nid };
  net().send({ type: "act", scene: sceneTag(floor), act });
}

// ── Inbound acts ──────────────────────────────────────────────────────────────
function handleAct(act: Act): void {
  if (!hooks) return;
  switch (act.k) {
    case "dmg": {
      // A replica hit one of our zombies (we're the authority for it).
      if (!enemyAuthorityIsMe()) return;
      const z = state.zombies.find((x) => x.nid === act.n && x.mode !== "dead");
      if (z) hooks.applyDamage(z, act.d, act.dx, act.dz, act.p);
      break;
    }
    case "kill": {
      // Authority killed something — juice + shared gold; the snapshot (or this
      // act) removes the ghost.
      const z = state.zombies.find((x) => x.nid === act.n && x.mode !== "dead");
      if (z) {
        hooks.removeZombie(z);
        state.zombies = state.zombies.filter((x) => x !== z);
        ghostTargets.delete(act.n);
      }
      hooks.onRemoteKill(act.x, act.z, act.kind, act.boss);
      break;
    }
    case "take": {
      const i = state.groundItems.findIndex((x) => x.nid === act.n);
      if (i >= 0) {
        hooks.removeItem(state.groundItems[i]);
        state.groundItems.splice(i, 1);
      }
      break;
    }
    case "hole": {
      // Mirror the authority's detonation. Replicas only — the authority
      // already tore its own hole before broadcasting, and doing it twice would
      // stack two colliders on one spot.
      if (enemyAuthorityIsMe()) return;
      hooks.tearHole(act.x, act.z, act.n);
      break;
    }
  }
}

/**
 * The knight just died: push one final pose tagged mode:"death" (bypassing the
 * 15Hz throttle) so peers gray the body out and STOP colliding with it — live
 * QA bounced marbles off a corpse. Poses resume automatically on retry.
 */
export function coopAnnounceDeath(): void {
  const p = state.player;
  if (!p || !isConnected()) return;
  net().send({ type: "move", x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, facing: p.facing, scene: sceneTag(floor), mode: "death" });
}

// ── Marble-vs-marble ──────────────────────────────────────────────────────────
/**
 * Knights collide with each other. Each client resolves only its OWN knight
 * (we can't move a peer's): push out of overlap; if we're rolling, reflect our
 * momentum off them like a bumpy wall; if we're standing and THEY are a rolling
 * marble, we get launched. Both sides run the same rule → both react.
 */
function playerCollisions(): void {
  const p = state.player;
  if (!p || !renderer) return;
  if (state.gameOver) return; // our own corpse doesn't bounce either
  for (const peer of renderer.positions()) {
    if (peer.mode === "death") continue; // never carom off a fallen knight
    const dx = p.x - peer.x;
    const dz = p.z - peer.z;
    const d = Math.hypot(dx, dz);
    if (d >= PLAYER_BOUNCE_R || d === 0) continue;
    const nx = dx / d;
    const nz = dz / d;
    // De-overlap our knight.
    p.x = peer.x + nx * PLAYER_BOUNCE_R;
    p.z = peer.z + nz * PLAYER_BOUNCE_R;
    if (p.momSpeed > 1) {
      // We're rolling: reflect momentum off the peer — and DOUBLE it. This is
      // the co-op jackpot: the solo combo ramp is deliberately slow (see
      // COMBO_CEIL_K/NSAT), so ricocheting off your teammate is the fastest
      // acceleration in the game. Both clients run the same rule, so a head-on
      // marble-vs-marble sends BOTH knights screaming apart.
      const dot = p.momX * nx + p.momZ * nz;
      if (dot < 0) {
        p.momX -= 2 * dot * nx;
        p.momZ -= 2 * dot * nz;
        p.momSpeed = Math.min(PINBALL_MAX_SPEED, p.momSpeed * 2);
        state.vfx?.burst(peer.x + nx * 0.25, 0.6, peer.z + nz * 0.25, 0xf0c040, 18, 6);
        state.hitstopT = Math.max(state.hitstopT, 0.05);
        sfxBumper();
      }
      state.vfx?.sparks(peer.x + nx * 0.25, 0.5, peer.z + nz * 0.25, nx, nz, 8);
      state.shakeT = Math.max(state.shakeT, 0.12);
    } else if (peer.mode === "ball") {
      // Standing knight hit by a rolling marble: get launched.
      p.momX = nx;
      p.momZ = nz;
      p.momSpeed = Math.max(p.momSpeed, 9);
      p.iframes = Math.max(p.iframes, 0.2);
      state.vfx?.sparks(p.x, 0.5, p.z, nx, nz, 10);
      state.shakeT = Math.max(state.shakeT, 0.12);
    }
  }
}
