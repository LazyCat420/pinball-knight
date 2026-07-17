/**
 * NPCs — the Magician, the Speed Witch and the Oracle Frog. Non-hostile
 * static-sprite actors with tiny state machines, completely outside the
 * combat pipeline. Ticked from core.simulate on the fixed step.
 *
 *  🎩 MAGICIAN — visits on his own clock, bows, TELEPORTS the knight to a
 *     random part of the floor (momentum preserved!), laughs, vanishes.
 *     Unkillable, unstoppable, suppressed while the Death Dealer is out.
 *  🧙 SPEED WITCH — revealed by smashing a cracked wall (once per floor).
 *     Touch her: half your hearts for a long turbo+spring-legs window.
 *  🐸 ORACLE FROG — waits in a dead end; touch it and a trail of embers
 *     traces the route to the stairs.
 */
import { state, type Npc } from "../state";
import {
  MAGICIAN_PERIOD,
  MAGICIAN_JITTER,
  MAGICIAN_FROM_LEVEL,
  MAGICIAN_BOW,
  MAGICIAN_LINGER,
  WITCH_BUFF_TIME,
  FROG_COOLDOWN,
  FROG_TRAIL_TILES,
  FROG_TRAIL_STAGGER,
  MERCHANT_SPEED,
  MERCHANT_FLEE_SPEED,
  MERCHANT_FLEE_RANGE,
  MERCHANT_CATCH_RANGE,
  PLAYER_R,
  PPU,
} from "../constants";
import { tileCenter, worldToTile, isWalkable, idx } from "../maze/generator";
import { moveCircle } from "../collision";
import { bfsDistances, flowStep } from "./ai";
import { createStaticSprite } from "../render/sprite";
import { NPC_PAINTS } from "../render/cel-painter";
import { syncActorMesh } from "./combat";
import { showToast, showPickupNote } from "../ui";
import { sfxCackle, sfxRibbit, sfxPickup } from "../audio";

/** Catching the merchant opens its shop — core registers the handler. */
let onMerchantCaught: (() => void) | null = null;
export function setMerchantCaughtHandler(fn: () => void): void {
  onMerchantCaught = fn;
}

/** Roll the countdown to the Magician's next visit. */
export function rollMagicianClock(): number {
  return MAGICIAN_PERIOD + (Math.random() * 2 - 1) * MAGICIAN_JITTER;
}

function makeNpc(kind: Npc["kind"], x: number, z: number): Npc {
  const sprite = createStaticSprite(NPC_PAINTS[kind]);
  sprite.mesh.position.set(x, 0, z);
  state.scene?.add(sprite.mesh);
  const npc: Npc = { kind, x, z, sprite, bobPhase: Math.random() * 6, t: 0, cooldownT: 0, phase: "enter" };
  syncActorMesh(npc as unknown as Parameters<typeof syncActorMesh>[0]);
  return npc;
}

/** Puff of arcane smoke — entrances and exits are always theatrical. */
function poof(x: number, z: number, n = 10): void {
  for (let k = 0; k < n; k++) {
    state.vfx?.dust(x + (Math.random() - 0.5) * 0.7, 0.1 + Math.random() * 0.7, z + (Math.random() - 0.5) * 0.7);
  }
  state.vfx?.sparks(x, 0.6, z, 0, 0, 8);
}

/** The Oracle Frog's dead-end perch, placed by the level plan. */
export function spawnFrog(i: number, j: number): void {
  const g = state.grid;
  if (!g) return;
  const c = tileCenter(g, i, j);
  const frog = makeNpc("frog", c.x, c.z);
  frog.phase = "idle";
  state.npcs.push(frog);
}

/** The Rolling Cart Merchant — a shop on wheels that slides the floor. */
export function spawnMerchant(i: number, j: number): void {
  const g = state.grid;
  if (!g) return;
  const c = tileCenter(g, i, j);
  const m = makeNpc("merchant", c.x, c.z);
  m.phase = "roll";
  m.vx = 0;
  m.vz = 0;
  state.npcs.push(m);
}

/** The Speed Witch steps out of the smashed masonry (secrets.ts hook). */
export function spawnWitch(x: number, z: number): void {
  if (state.witchSpawned) return;
  state.witchSpawned = true;
  const witch = makeNpc("witch", x, z);
  witch.phase = "idle";
  state.npcs.push(witch);
  poof(x, z);
  showToast("🧙 THE SPEED WITCH", "she offers a trade — touch her to take it");
}

/** Pick a random walkable teleport destination, with the Magician's taste. */
function pickTrickDestination(): { x: number; z: number } | null {
  const g = state.grid;
  const p = state.player;
  if (!g || !p) return null;
  const roll = Math.random();
  // 25%: treasure-adjacent. 15%: into the thick of the horde. 60%: anywhere.
  if (roll < 0.25 && state.groundItems.length > 0) {
    const it = state.groundItems[Math.floor(Math.random() * state.groundItems.length)];
    return { x: it.x, z: it.z };
  }
  if (roll < 0.4) {
    const live = state.zombies.filter((z) => z.mode !== "dead" && z.kind !== "reaper");
    if (live.length > 0) {
      const z = live[Math.floor(Math.random() * live.length)];
      const t = worldToTile(g, z.x, z.z);
      if (isWalkable(g, t.i, t.j)) return tileCenter(g, t.i, t.j);
    }
  }
  for (let n = 0; n < 30; n++) {
    const i = 1 + Math.floor(Math.random() * (g.w - 2));
    const j = 1 + Math.floor(Math.random() * (g.h - 2));
    if (!isWalkable(g, i, j)) continue;
    const c = tileCenter(g, i, j);
    if (Math.hypot(c.x - p.x, c.z - p.z) < 6) continue; // a trick, not a shuffle
    return c;
  }
  return null;
}

/** The Magician appears at the edge of the view and begins his act. */
function spawnMagician(): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p) return;
  // Enter a handful of tiles out — close enough to see the bow.
  let spot: { x: number; z: number } | null = null;
  for (let n = 0; n < 24 && !spot; n++) {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 2.5;
    const t = worldToTile(g, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r);
    if (isWalkable(g, t.i, t.j)) spot = tileCenter(g, t.i, t.j);
  }
  if (!spot) spot = { x: p.x + 2, z: p.z };
  const m = makeNpc("magician", spot.x, spot.z);
  m.phase = "bow";
  state.npcs.push(m);
  poof(spot.x, spot.z);
  showToast("🎩 THE MAGICIAN", "he bows…");
}

/** The trick itself: the knight vanishes here, reappears there. He laughs. */
function magicianTrick(m: Npc): void {
  const p = state.player;
  if (!p) return;
  const dest = pickTrickDestination();
  if (dest) {
    poof(p.x, p.z, 12);
    p.x = dest.x;
    p.z = dest.z;
    // Momentum is PRESERVED through the teleport — arriving at 20 u/s in a
    // bumper chamber is the feature, not a bug.
    syncActorMesh(p);
    poof(p.x, p.z, 12);
    state.shakeT = Math.max(state.shakeT, 0.2);
    showToast("🎩 TA-DAAA!", "…you are somewhere else. he finds this hilarious");
  }
  sfxCackle();
  m.phase = "linger";
  m.t = 0;
}

/** The frog consults: queue an ember trail tracing the way to the stairs. */
function frogConsult(frog: Npc): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p || !state.stairs) return;
  frog.cooldownT = FROG_COOLDOWN;
  sfxRibbit();
  // BFS from the STAIRS; walking downhill from the player IS the route there.
  const field = bfsDistances(g, state.stairs.i, state.stairs.j);
  let cur = worldToTile(g, p.x, p.z);
  const trail: Array<{ x: number; z: number }> = [];
  for (let n = 0; n < FROG_TRAIL_TILES; n++) {
    const next = flowStep(g, field, cur.i, cur.j);
    if (!next) break;
    trail.push(tileCenter(g, next.i, next.j));
    if (field[idx(g, next.i, next.j)] <= 0) break; // arrived
    cur = next;
  }
  state.frogTrail = trail;
  state.frogTrailT = 0;
  showToast("🐸 THE ORACLE CROAKS", "follow the embers to the stairs");
}

/**
 * Tick every NPC (fixed sim step): the magician's visit clock + act phases,
 * witch/frog touch checks, and the ember-trail drip-feed.
 */
export function updateNpcs(dt: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;

  // ── The Magician's clock ── suppressed while the reaper hunts (two
  // uncontrollable actors at once is unfair, not chaotic) and during rides.
  if (state.level >= MAGICIAN_FROM_LEVEL && !state.reaperOut) {
    state.magicianT -= dt;
    if (state.magicianT <= 0 && !state.npcs.some((n) => n.kind === "magician")) {
      state.magicianT = rollMagicianClock();
      spawnMagician();
    }
  }

  // ── The frog's ember trail drips out a mote at a time ──
  if (state.frogTrail.length > 0) {
    state.frogTrailT -= dt;
    if (state.frogTrailT <= 0) {
      state.frogTrailT = FROG_TRAIL_STAGGER;
      const spot = state.frogTrail.shift()!;
      state.vfx?.ember(spot.x, 0.35, spot.z);
      state.vfx?.ember(spot.x, 0.15, spot.z);
    }
  }

  for (let k = state.npcs.length - 1; k >= 0; k--) {
    const n = state.npcs[k];
    n.t += dt;
    n.cooldownT = Math.max(0, n.cooldownT - dt);
    const dist = Math.hypot(n.x - p.x, n.z - p.z);

    if (n.kind === "magician") {
      if (n.phase === "bow" && n.t >= MAGICIAN_BOW) {
        magicianTrick(n);
      } else if (n.phase === "linger" && n.t >= MAGICIAN_LINGER) {
        poof(n.x, n.z);
        state.scene?.remove(n.sprite.mesh);
        n.sprite.dispose();
        state.npcs.splice(k, 1);
        continue;
      }
    } else if (n.kind === "witch" && dist <= 0.8) {
      // The trade: half your hearts, rounded up in her favour.
      if (p.hp > 2) {
        p.hp = Math.ceil(p.hp / 2);
        p.turboT = WITCH_BUFF_TIME;
        p.springT = WITCH_BUFF_TIME;
        state.hudDirty = true;
        showToast("🧙 THE TRADE IS STRUCK", `half your blood for ${WITCH_BUFF_TIME}s of SPEED`);
        sfxPickup();
        poof(n.x, n.z);
        state.scene?.remove(n.sprite.mesh);
        n.sprite.dispose();
        state.npcs.splice(k, 1);
        continue;
      }
      if (n.cooldownT <= 0) {
        n.cooldownT = 4;
        showPickupNote("🧙 “come back with more blood in you”");
      }
    } else if (n.kind === "frog" && dist <= 0.75 && n.cooldownT <= 0) {
      frogConsult(n);
    } else if (n.kind === "merchant") {
      updateMerchant(n, dist, dt);
    }

    // Idle bob — NPCs breathe so they don't read as props. The rolling cart
    // trundles (a faster wobble) rather than bobbing.
    const amp = n.kind === "merchant" ? 0.02 : 0.03;
    const spd = n.kind === "merchant" ? 5 : 2.2;
    const y = 0.03 + Math.sin(state.elapsed * spd + n.bobPhase) * amp;
    n.sprite.mesh.position.y = Math.round(y * PPU) / PPU;
  }
}

/**
 * The merchant slides the corridors and FLEES when you close in (you have to
 * corner it). Catch it → its shop opens (core handler). Once shopped, it just
 * mills about so you can find it again mid-floor.
 */
function updateMerchant(n: Npc, dist: number, dt: number): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p) return;

  if (dist <= MERCHANT_CATCH_RANGE && !state.shopEl && n.cooldownT <= 0) {
    n.vx = 0;
    n.vz = 0;
    n.shopped = true;
    n.cooldownT = 3; // don't re-open the instant you close it — step away first
    onMerchantCaught?.();
    return;
  }

  // Steer: flee from the player when near, otherwise amble along its heading.
  let hx = n.vx ?? 0;
  let hz = n.vz ?? 0;
  const speed = dist < MERCHANT_FLEE_RANGE ? MERCHANT_FLEE_SPEED : MERCHANT_SPEED;
  if (dist < MERCHANT_FLEE_RANGE && dist > 1e-3) {
    hx = (n.x - p.x) / dist; // straight away from the player
    hz = (n.z - p.z) / dist;
  } else if (Math.hypot(hx, hz) < 0.1 || Math.random() < 0.6 * dt) {
    const a = Math.random() * Math.PI * 2; // pick a new amble heading now and then
    hx = Math.cos(a);
    hz = Math.sin(a);
  }
  const hl = Math.hypot(hx, hz) || 1;
  n.vx = hx / hl;
  n.vz = hz / hl;
  const res = moveCircle(g, n.x, n.z, PLAYER_R, n.vx * speed * dt, n.vz * speed * dt);
  // Bounced off a wall — pick a fresh heading next frame.
  if (Math.abs(res.x - (n.x + n.vx * speed * dt)) > 1e-3) n.vx = -(n.vx ?? 0);
  if (Math.abs(res.z - (n.z + n.vz * speed * dt)) > 1e-3) n.vz = -(n.vz ?? 0);
  n.x = res.x;
  n.z = res.z;
  syncActorMesh(n as unknown as Parameters<typeof syncActorMesh>[0]);
}

/** Per-level teardown (dispose.ts calls this via core's disposeLevel path). */
export function disposeNpcs(): void {
  for (const n of state.npcs) {
    state.scene?.remove(n.sprite.mesh);
    n.sprite.dispose();
  }
  state.npcs = [];
  state.frogTrail = [];
}
