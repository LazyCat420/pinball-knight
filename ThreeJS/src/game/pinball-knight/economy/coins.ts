/**
 * The coin economy — mint, cap, sweep, credit, and the burst/rest/magnet
 * physics.
 *
 * Extracted verbatim from core.ts. Coins are the only ground item that carries
 * VALUE, so every path that removes one is a path that can lose or duplicate
 * gold; keeping them in one module is what makes that auditable. The invariants
 * are pinned by coins.test.ts.
 */
import { state } from "../state";
import { addGold } from "../../../utils/gold-wallet";
import { skillAgg } from "../skill-runtime";
import { removeGroundItem } from "./ground-items";
import { createStaticSprite } from "../engine/render/sprite";
import { ITEM_PAINTS } from "../render/cel-painter";
import { at } from "../maze/generator";
import {
  PPU,
  COIN_LIVE_CAP,
  COIN_MAX_PER_DROP,
  COIN_SPAWN_Y,
  COIN_BURST_VY,
  COIN_BURST_SPREAD,
  COIN_BURST_DRAG,
  COIN_GRAVITY,
  COIN_BOUNCE,
  COIN_SETTLE_VY,
  COIN_ARM_TIME,
  COIN_REST_Y,
  COIN_CHEST_Y,
  COIN_DROP_SCALE,
  COIN_STACK_VALUE,
  COIN_STACK_DROP_SCALE,
  COIN_MAGNET_TIME,
  COIN_MAGNET_RANGE,
  COIN_MAGNET_ARC,
  COIN_AURA_RANGE_MULT,
  MAGNET_PULL_RADIUS,
} from "../constants";

export function creditGold(v: number): void {
  if (v <= 0) return;
  // Coin Magnet ranks / the Lucky Coin legacy perk scale COIN value here, the
  // one funnel every physical coin credit passes through.
  const scaled = Math.round(v * skillAgg().goldMult);
  state.goldRun += scaled;
  addGold(scaled, "dungeon-game");
  state.hudDirty = true;
}

/**
 * How many physical coins a drop of `total` gold mints. One coin reads as a
 * bug; a handful reads as loot. Capped so a boss windfall is a satisfying
 * fistful and not a coin fountain.
 */
export function coinCountFor(total: number): number {
  return Math.max(1, Math.min(Math.floor(total), COIN_MAX_PER_DROP));
}

/**
 * Split `total` gold across `n` coins with ZERO drift: each coin gets the floor
 * share and the first `remainder` coins get one extra unit, so the values sum to
 * exactly `total` for every input. (Rounding `total / n` per coin — the obvious
 * version — either invents gold or eats it, and both are unacceptable when the
 * split sits between the kill and the wallet.)
 */
export function splitCoinValue(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  let rem = total - base * n;
  return Array.from({ length: n }, () => base + (rem-- > 0 ? 1 : 0));
}

/**
 * Too many coins on the floor is a frame-rate problem, so the excess is
 * FORCE-CREDITED (oldest first) rather than left lying around or binned. The
 * player still gets every unit — they just don't get to watch it fly.
 */
export function enforceCoinCap(): void {
  let live = 0;
  for (const it of state.groundItems) if (it.kind === "coin") live++;
  for (let k = 0; k < state.groundItems.length && live > COIN_LIVE_CAP; k++) {
    if (state.groundItems[k].kind !== "coin") continue;
    creditGold(state.groundItems[k].value ?? 0);
    removeGroundItem(k);
    k--;
    live--;
  }
}

/**
 * The floor is about to be torn down (descend, death, exit): every coin still
 * lying on it is CREDITED, not binned. Gold earned by killing a thing is the
 * player's whether or not they walked back over the drop — and disposeLevel
 * would otherwise silently delete it.
 */
export function sweepCoins(): void {
  for (let k = state.groundItems.length - 1; k >= 0; k--) {
    if (state.groundItems[k].kind !== "coin") continue;
    creditGold(state.groundItems[k].value ?? 0);
    removeGroundItem(k);
  }
}

/**
 * A kill DROPS coins: the payout splits into a small burst of physical tokens
 * that pop out of the corpse, land, and get magnet-collected. Falls back to an
 * instant credit only when there's no scene (headless harness).
 */
export function spawnCoin(x: number, z: number, value: number): void {
  const total = Math.floor(value);
  if (total <= 0) return;
  if (!state.scene) {
    creditGold(total);
    return;
  }
  const n = coinCountFor(total);
  const parts = splitCoinValue(total, n);
  for (let i = 0; i < n; i++) {
    // Fan the coins evenly around the corpse (plus jitter) so a burst spreads
    // instead of clumping — an even ring reads as "it burst out of the thing".
    const ang = (i / n) * Math.PI * 2 + Math.random() * 0.9;
    const spd = COIN_BURST_SPREAD * (0.45 + Math.random() * 0.75);
    const isStack = parts[i] >= COIN_STACK_VALUE;
    const paint = isStack ? ITEM_PAINTS.coinStack : ITEM_PAINTS.coin;
    const sprite = createStaticSprite(paint);
    // Shrink the dropped token to a Diablo-style pile — see COIN_DROP_SCALE.
    sprite.mesh.scale.multiplyScalar(isStack ? COIN_STACK_DROP_SCALE : COIN_DROP_SCALE);
    sprite.mesh.position.set(x, COIN_SPAWN_Y, z);
    state.scene.add(sprite.mesh);
    state.groundItems.push({
      kind: "coin",
      id: "coin",
      value: parts[i],
      x,
      z,
      sprite,
      bobPhase: Math.random() * Math.PI * 2,
      coin: {
        phase: "burst",
        y: COIN_SPAWN_Y,
        vx: Math.cos(ang) * spd,
        vy: COIN_BURST_VY * (0.85 + Math.random() * 0.3),
        vz: Math.sin(ang) * spd,
        age: 0,
        magT: 0,
        fromX: x,
        fromY: COIN_REST_Y,
        fromZ: z,
      },
    });
  }
  state.vfx?.sparks(x, COIN_SPAWN_Y, z, 0, 0, 5);
  enforceCoinCap();
}

/**
 * Coin physics — burst, rest, magnet.
 *
 * THE OLD BUG, because it is a bug class worth naming: the magnet was
 * `it.x += (p.x - it.x) * 0.22`, applied once per RENDERED FRAME. That is
 * exponential approach with the *frame* as its time unit, and it fails twice.
 * (1) It's far too fast to see: closing 2.6 → 0.45 units takes
 * log(0.45 / 2.6) / log(1 - 0.22) ≈ 7.1 frames — 118ms — so the coin existed
 * but nothing about it registered, which is exactly the "it's just the numbers"
 * complaint. (2) It's frame-rate dependent: the same coin took 118ms at 60Hz
 * and 49ms at 144Hz, because a per-frame fraction is not a speed, it's a speed
 * multiplied by whatever the display happens to refresh at.
 *
 * The fix is to stop smoothing and start INTEGRATING against `dt`. The burst is
 * ordinary projectile motion; the magnet is parametrized on ELAPSED TIME
 * (u = magT / COIN_MAGNET_TIME), so the flight lasts COIN_MAGNET_TIME seconds
 * at any refresh rate, exactly, and the arc is trivially shapeable. (Where you
 * genuinely do want exponential smoothing, the frame-rate-correct form is
 * `1 - Math.pow(1 - rate, dt * 60)` — but a fixed-duration flight is the better
 * fit for something the player is meant to watch land.)
 */
export function updateCoins(dt: number): void {
  const p = state.player;
  // Magnet Aura / Magnet Ball widens the coin's OWN capture range rather than dragging the
  // coin itself (abilities.ts skips coins) — two systems writing one position in
  // the same frame is how you get jitter and double-speed pickups.
  const range = p && p.material === "magnet"
    ? MAGNET_PULL_RADIUS
    : COIN_MAGNET_RANGE * (p && p.magnetAuraT > 0 ? COIN_AURA_RANGE_MULT : 1);

  for (const it of state.groundItems) {
    const c = it.coin;
    if (!c) continue;
    c.age += dt;

    if (c.phase === "burst") {
      c.vy -= COIN_GRAVITY * dt;
      c.y += c.vy * dt;
      it.x += c.vx * dt;
      it.z += c.vz * dt;
      // Bleed the outward scatter so coins land in a tight ring around the
      // corpse instead of skating off across the room.
      const drag = Math.max(0, 1 - COIN_BURST_DRAG * dt);
      c.vx *= drag;
      c.vz *= drag;
      if (c.y <= COIN_REST_Y) {
        c.y = COIN_REST_Y;
        if (-c.vy > COIN_SETTLE_VY) {
          c.vy = -c.vy * COIN_BOUNCE; // one or two diminishing bounces, then still
        } else {
          c.phase = "rest";
          c.vx = c.vy = c.vz = 0;
        }
      }
    } else if (c.phase === "rest") {
      // Deliberately the SAME bob the other ground items use, so a coin on the
      // floor reads as part of the same loot system as a potion or a card.
      c.y = COIN_REST_Y + Math.sin(state.elapsed * 2.6 + it.bobPhase) * 0.05;
      if (p && c.age >= COIN_ARM_TIME && Math.hypot(it.x - p.x, it.z - p.z) < range) {
        c.phase = "magnet";
        c.magT = 0;
        c.fromX = it.x;
        c.fromY = c.y;
        c.fromZ = it.z;
      }
    } else if (p) {
      // MAGNET: ease-IN toward the LIVE player position (so it keeps homing if
      // they run) along an arc that RISES to chest height. u² starts slow and
      // accelerates hard into the body — that acceleration is what reads as
      // magnetic; a linear slide reads as being dragged on a string.
      c.magT += dt;
      const u = Math.min(1, c.magT / COIN_MAGNET_TIME);
      const e = u * u;
      it.x = c.fromX + (p.x - c.fromX) * e;
      it.z = c.fromZ + (p.z - c.fromZ) * e;
      c.y = c.fromY + (COIN_CHEST_Y - c.fromY) * e + Math.sin(Math.PI * u) * COIN_MAGNET_ARC;
      if (Math.random() < dt * 24) state.vfx?.mote(it.x, c.y, it.z, 0xffd98a);
    }

    // Snap to the pixel grid like the rest of the loot so it doesn't shimmer.
    it.sprite.mesh.position.set(it.x, Math.round(c.y * PPU) / PPU, it.z);
  }
}
