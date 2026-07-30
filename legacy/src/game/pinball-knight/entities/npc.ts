/**
 * NPCs — the Magician, the Speed Witch and the Oracle Frog. Non-hostile
 * static-sprite actors with tiny state machines, completely outside the
 * combat pipeline. Ticked from core.simulate on the fixed step.
 *
 *  🎩 MAGICIAN — visits on his own clock, bows, SHUFFLES THE ROOM around the
 *     knight (loot swaps seats, pinball furniture trades tiles), laughs,
 *     vanishes. He never moves YOU — the trapdoor is the only teleport in the
 *     game. Unkillable, unstoppable, suppressed while the Death Dealer is out.
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
  TRICK_RADIUS,
  TRICK_SAFE_RADIUS,
  TRICK_PART_SWAPS,
  TRICK_FIXED_KINDS,
  WITCH_BUFF_TIME,
  FROG_COOLDOWN,
  FROG_TRAIL_TILES,
  FROG_TRAIL_STAGGER,
  MERCHANT_SPEED,
  MERCHANT_FLEE_SPEED,
  MERCHANT_FLEE_RANGE,
  MERCHANT_CATCH_RANGE,
  MERCHANT_BOUNCE_DWELL,
  MERCHANT_BELL_PERIOD,
  MERCHANT_BELL_RANGE,
  PLAYER_R,
  PPU,
} from "../constants";
import { tileCenter, worldToTile, isWalkable, idx } from "../maze/generator";
import { moveCircle } from "../engine/collision";
import { bfsDistances, bfsDistancesOwned, flowStep, flowAway } from "../engine/flow-field";
import { createStaticSprite } from "../engine/render/sprite";
import { NPC_PAINTS } from "../render/cel-painter";
import { syncActorMesh } from "./combat";
import { showToast, showPickupNote } from "../ui";
import { isOpen as uiIsOpen } from "../gui/stack";
import { sfxCackle, sfxRibbit, sfxPickup, sfxCartBell } from "../sfx";

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

/** Fisher-Yates on a scratch array — the shuffle behind the Magician's shuffle. */
function shuffled<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
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

/**
 * The trick itself — THE SHUFFLE. He never touches the knight (the trapdoor is
 * the only thing on the floor that moves you); he moves the ROOM. Loot swaps
 * places with loot, and the nearby pinball furniture swaps places with itself,
 * so the lane you had memorised is not the lane you're standing in. Every
 * destination was already a valid occupied spot, so nothing can land in a wall.
 */
function magicianTrick(m: Npc): void {
  const p = state.player;
  if (!p) return;

  // ── The loot shuffle: every ground item takes another's place ──
  const items = state.groundItems.filter((it) => Math.hypot(it.x - p.x, it.z - p.z) <= TRICK_RADIUS);
  let moved = 0;
  if (items.length >= 2) {
    const spots = shuffled(items.map((it) => ({ x: it.x, z: it.z })));
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      if (Math.hypot(spots[k].x - it.x, spots[k].z - it.z) < 0.05) continue; // drew its own seat
      poof(it.x, it.z, 4);
      it.x = spots[k].x;
      it.z = spots[k].z;
      it.sprite.mesh.position.x = it.x;
      it.sprite.mesh.position.z = it.z;
      poof(it.x, it.z, 4);
      moved++;
    }
  }

  // ── The furniture shuffle: nearby parts trade tiles in pairs ──
  // HAZARDS ARE EXCLUDED. A pit or a fire vent materialising on the tile you're
  // standing on isn't a trick, it's an ambush you couldn't have read.
  const parts = shuffled(
    state.pinballParts.filter((q) => {
      if ((TRICK_FIXED_KINDS as readonly string[]).includes(q.kind)) return false;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      return d <= TRICK_RADIUS && d > TRICK_SAFE_RADIUS;
    }),
  ).slice(0, TRICK_PART_SWAPS * 2);
  let swapped = 0;
  for (let k = 0; k + 1 < parts.length; k += 2) {
    const a = parts[k];
    const b = parts[k + 1];
    if (a.kind === b.kind) continue; // swapping two bumpers changes nothing
    poof(a.x, a.z, 5);
    poof(b.x, b.z, 5);
    [a.i, b.i] = [b.i, a.i];
    [a.j, b.j] = [b.j, a.j];
    [a.x, b.x] = [b.x, a.x];
    [a.z, b.z] = [b.z, a.z];
    a.mesh.position.set(a.x, a.mesh.position.y, a.z);
    b.mesh.position.set(b.x, b.mesh.position.y, b.z);
    swapped++;
  }

  if (moved > 0 || swapped > 0) {
    state.shakeT = Math.max(state.shakeT, 0.2);
    const bits = [moved > 0 ? `${moved} treasures` : "", swapped > 0 ? `${swapped} lanes` : ""].filter(Boolean);
    showToast("🎩 TA-DAAA!", `…${bits.join(" and ")} are not where you left them`);
  } else {
    showToast("🎩 …NOTHING UP HIS SLEEVE", "no props to work with. he is embarrassed");
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
  const field = bfsDistancesOwned(g, state.stairs.i, state.stairs.j); // held while stepping
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
 * corner it). Catch it → its shop opens (core handler). Once shopped it stops
 * running for good — it has your gold, it has no reason to keep sprinting —
 * and just mills about so you can find it again mid-floor.
 *
 * It retreats along the zombie FLOW FIELD (uphill, away from you) rather than
 * on a straight-line repulsion bearing. Repulsion steering in a maze always
 * ends up in the perimeter corner furthest from the pursuer: the cart presses
 * into the nearest wall, moveCircle converts the blocked component into pure
 * tangential slide, and the slide's sign is stable while you stay on one side
 * of it — so it rides that wall in one direction forever. That was the bug.
 */
function updateMerchant(n: Npc, dist: number, dt: number): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p) return;

  n.bellT = (n.bellT ?? 0) - dt;
  if (n.bellT <= 0) {
    // The cart-bell: it announces itself on a timer so it's something you can
    // HUNT rather than something you happen to walk into. Quieter with range.
    n.bellT = MERCHANT_BELL_PERIOD;
    if (dist < MERCHANT_BELL_RANGE) sfxCartBell(1 - dist / MERCHANT_BELL_RANGE);
  }

  if (dist <= MERCHANT_CATCH_RANGE && !uiIsOpen("shop") && n.cooldownT <= 0) {
    n.vx = 0;
    n.vz = 0;
    n.shopped = true;
    n.cooldownT = 3; // don't re-open the instant you close it — step away first
    onMerchantCaught?.();
    return;
  }

  // Once you've traded with it the chase is over — it ambles from then on.
  const fleeing = !n.shopped && dist < MERCHANT_FLEE_RANGE;
  const speed = fleeing ? MERCHANT_FLEE_SPEED : MERCHANT_SPEED;

  let hx = n.vx ?? 0;
  let hz = n.vz ?? 0;
  n.dwellT = Math.max(0, (n.dwellT ?? 0) - dt);

  if (n.dwellT > 0) {
    // Committed to the post-bounce heading. Flee mode may NOT overwrite it —
    // that overwrite is precisely what made the wall-bounce dead code.
  } else if (fleeing) {
    // Retreat one tile uphill on the distance-to-player field: maze-aware, so
    // it rounds corners instead of grinding along them. The field is the same
    // one the horde uses, refreshed on core's FLOW_INTERVAL — free to read.
    const here = worldToTile(g, n.x, n.z);
    const away = state.flowField ? flowAway(g, state.flowField, here.i, here.j) : null;
    if (away) {
      const c = tileCenter(g, away.i, away.j);
      hx = c.x - n.x;
      hz = c.z - n.z;
    } else if (dist > 1e-3) {
      // Cornered (or the field is stale): fall back to raw repulsion.
      hx = (n.x - p.x) / dist;
      hz = (n.z - p.z) / dist;
    }
  } else if (Math.hypot(hx, hz) < 0.1 || Math.random() < 0.6 * dt) {
    const a = Math.random() * Math.PI * 2; // pick a new amble heading now and then
    hx = Math.cos(a);
    hz = Math.sin(a);
  }

  const hl = Math.hypot(hx, hz) || 1;
  n.vx = hx / hl;
  n.vz = hz / hl;
  const stepX = n.vx * speed * dt;
  const stepZ = n.vz * speed * dt;
  const res = moveCircle(g, n.x, n.z, PLAYER_R, stepX, stepZ);
  // Blocked: flip the blocked component and COMMIT to it for a beat, so the
  // next tick's steering can't immediately undo the bounce.
  const hitX = Math.abs(res.x - (n.x + stepX)) > 1e-3;
  const hitZ = Math.abs(res.z - (n.z + stepZ)) > 1e-3;
  if (hitX || hitZ) {
    if (hitX) n.vx = -(n.vx ?? 0);
    if (hitZ) n.vz = -(n.vz ?? 0);
    n.dwellT = MERCHANT_BOUNCE_DWELL;
  }
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
