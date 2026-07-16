/**
 * Hit resolution — damage, i-frames, knockback, durability and death all
 * resolve HERE, in one place, rather than being smeared across player.ts,
 * zombie.ts and projectiles.ts.
 */
import { state, activeWeapon, type Zombie } from "../state";
import {
  KNOCKBACK_ZOMBIE,
  KNOCKBACK_PLAYER,
  PLAYER_IFRAMES,
  ZOMBIE_DAMAGE,
  ZOMBIE_R,
  PLAYER_R,
  GOLD_PER_KILL,
  PPU,
  HITSTOP_HIT,
  HITSTOP_KILL,
  SHAKE_ON_HIT,
  SHAKE_ON_KILL,
  ULT_CHARGE_PER_KILL,
  BRUTE_DAMAGE,
  BRUTE_KNOCKBACK,
} from "../constants";
import { moveCircle } from "../collision";
import type { Facing } from "../render/animator";
import { screenDirToWorld } from "../camera";
import { addGold } from "../../../utils/gold-wallet";
import { WEAPONS, GEAR, degradeWeapon, absorbDamage, RAGE_DAMAGE_MULT } from "../items";

/** Player's outgoing damage after the rage buff (2× while active). */
export function playerDamage(base: number): number {
  return state.player && state.player.rageT > 0 ? base * RAGE_DAMAGE_MULT : base;
}

/**
 * Callback invoked at (x,z) when a boss dies — core registers it to drop the
 * reward (gold + a health potion). A callback rather than a direct import keeps
 * combat.ts free of a circular dependency on core.ts.
 */
let onBossDefeated: ((x: number, z: number) => void) | null = null;
export function setBossDefeatedHandler(fn: (x: number, z: number) => void): void {
  onBossDefeated = fn;
}
import { sfxHit, sfxZombieDie, sfxHurt, sfxBreak } from "../audio";
import { showToast, updateFpsStreak } from "../ui";

/**
 * Facing → WORLD ground direction. Facings are SCREEN-relative (the art's "E"
 * is screen-right), so under the isometric yaw each cardinal maps to a world
 * diagonal. Attack arcs, projectile aim, knockback and steering all use these.
 */
export const FACING_VEC: Record<Facing, [number, number]> = (() => {
  const v = (sx: number, sz: number): [number, number] => {
    const w = screenDirToWorld(sx, sz);
    return [w.x, w.z];
  };
  return { N: v(0, -1), S: v(0, 1), E: v(1, 0), W: v(-1, 0) };
})();

const FLASH_TIME = 0.12;

const ISO = Math.SQRT1_2;

/**
 * Snap an actor's mesh to its logical position so its texels land on whole
 * render-target pixels — unsnapped sprites shimmer as they move (BLUEPRINT
 * §4.3). Under the 45° yaw, world axes no longer map to screen axes, so the
 * snap happens on the camera-aligned diagonals (u = screen-x, v = depth).
 */
export function syncActorMesh(a: { sprite: { mesh: { position: { set(x: number, y: number, z: number): void } } }; x: number; z: number }): void {
  const u = (a.x - a.z) * ISO;
  const v = (a.x + a.z) * ISO;
  const su = Math.round(u * PPU) / PPU;
  const sv = Math.round(v * PPU) / PPU;
  a.sprite.mesh.position.set((sv + su) * ISO, 0, (sv - su) * ISO);
}

/**
 * The one damage funnel for zombies — melee swings and every projectile end
 * up here. (dirx,dirz) is the incoming hit direction (need not be unit);
 * `push` scales the wall-aware knockback.
 */
export function damageZombie(z: Zombie, damage: number, dirx: number, dirz: number, push: number): void {
  const g = state.grid;
  if (!g || z.mode === "dead") return;

  z.hp -= damage;
  z.aggro = true; // hitting a dormant zombie certainly wakes it
  z.flashT = FLASH_TIME;
  z.sprite.setTint(0xff6a6a);

  // Impact juice: sparks along the blow, a spray of rot, a beat of hit-freeze
  // and a small camera kick. Kills get the bigger version below.
  state.vfx?.sparks(z.x, 0.6, z.z, dirx, dirz, 9);
  state.vfx?.blood(z.x, 0.6, z.z, "green", 8);
  state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
  state.shakeT = Math.max(state.shakeT, SHAKE_ON_HIT);

  if (push > 0) {
    const d = Math.hypot(dirx, dirz);
    if (d > 1e-4) {
      const res = moveCircle(g, z.x, z.z, ZOMBIE_R, (dirx / d) * push, (dirz / d) * push);
      z.x = res.x;
      z.z = res.z;
      syncActorMesh(z);
    }
  }

  if (z.hp <= 0) {
    killZombie(z);
  } else {
    sfxHit();
  }
}

/**
 * One use of the active weapon (a connected swing, or a shot leaving the
 * barrel). Handles the whole break path: the slot empties, and if the OTHER
 * slot still holds something we auto-switch to it — an empty hand with a
 * loaded gun on your belt would just be annoying.
 */
export function wearActiveWeapon(): void {
  const slot = state.weaponSlots[state.activeSlot];
  if (!slot) return; // fists — nothing to wear down

  const def = WEAPONS[slot.id];
  const worn = degradeWeapon(slot);
  if (!worn.broke) {
    state.weaponSlots[state.activeSlot] = worn.weapon;
    state.hudDirty = true;
    return;
  }

  state.weaponSlots[state.activeSlot] = null;
  sfxBreak();
  const spent = def.kind === "ranged" ? "out of ammo" : "broke";
  const other = 1 - state.activeSlot;
  if (state.weaponSlots[other]) {
    state.activeSlot = other;
    showToast(`${def.icon} ${def.label.toUpperCase()} ${spent.toUpperCase()}`, `switched to ${WEAPONS[state.weaponSlots[other]!.id].label.toLowerCase()}`);
  } else {
    showToast(`${def.icon} ${def.label.toUpperCase()} ${spent.toUpperCase()}`, "fists it is");
  }
  state.hudDirty = true;
}

/**
 * How a specific melee MOVE scales the equipped weapon on connect. A plain light
 * swing passes 1× everything; a heavy or combo finisher widens the arc, extends
 * reach, hits harder and shoves further. Defaults keep the old single-swing
 * behaviour for any caller that doesn't pass one.
 */
export interface MeleeScale {
  damageMul: number;
  arcMul: number;
  rangeMul: number;
  knockbackMul: number;
}
const UNIT_MELEE: MeleeScale = { damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1 };

/**
 * The player's melee swing lands, with whatever is in hand: range, arc and
 * damage come from the equipped weapon SCALED by the current move (light /
 * combo finisher / heavy). A swing that CONNECTS costs a point of durability.
 * Weapons break on use — the swing that breaks the chair still hits with it.
 *
 * arcMul WIDENS the arc: since the gate is `dot >= arcCos`, a wider arc means a
 * SMALLER cosine threshold, so we lerp arcCos toward -1 (full circle) by arcMul.
 */
export function resolvePlayerAttack(scale: MeleeScale = UNIT_MELEE): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return false;

  const w = WEAPONS[activeWeapon().id];
  const [fx, fz] = FACING_VEC[p.facing];
  const range = w.range * scale.rangeMul;
  // Widen the arc for heavy/finisher: pull the cosine gate toward -1.
  const arcCos = w.arcCos - (w.arcCos - -1) * Math.min(1, Math.max(0, scale.arcMul - 1));
  let landed = false;

  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    // At point-blank range the arc test divides by ~0 — inside the bodies'
    // combined radius it's a hit no matter the angle.
    if (d > PLAYER_R + ZOMBIE_R) {
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < arcCos) continue;
    }

    landed = true;
    // Knockback along the swing, wall-aware. Heavier weapons + heavier moves shove harder.
    const dmg = playerDamage(w.damage * scale.damageMul);
    const push = KNOCKBACK_ZOMBIE * (1 + (dmg - 1) * 0.35) * scale.knockbackMul;
    damageZombie(z, dmg, d > 1e-4 ? dx : fx, d > 1e-4 ? dz : fz, push);
  }

  if (landed) wearActiveWeapon();

  return landed;
}

function killZombie(z: Zombie): void {
  z.mode = "dead";
  z.anim.play("death", { force: true });
  // A death pops a bigger gore burst, a longer freeze and a heavier kick.
  state.vfx?.blood(z.x, 0.6, z.z, "green", 20);
  state.vfx?.sparks(z.x, 0.6, z.z, 0, 0, 6);
  // In first person you're right on top of the kill — double the gore with a
  // second red splatter so a frag reads as a proper Doom-style gib.
  if (state.fpsActive) {
    state.vfx?.blood(z.x, 0.7, z.z, "red", 16);
    state.vfx?.sparks(z.x, 0.7, z.z, 0, 0, 8);
  }
  // Killing the OVERLORD is the milestone: a huge gore blast, a bonus gold
  // windfall and a guaranteed health-potion drop right where it fell.
  if (z.boss) {
    state.vfx?.blood(z.x, 0.9, z.z, "red", 40);
    state.vfx?.blood(z.x, 0.6, z.z, "green", 40);
    state.vfx?.sparks(z.x, 0.9, z.z, 0, 0, 24);
    state.shakeT = Math.max(state.shakeT, 0.6);
    onBossDefeated?.(z.x, z.z);
  }
  state.hitstopT = Math.max(state.hitstopT, z.boss ? HITSTOP_KILL * 2.5 : HITSTOP_KILL);
  state.shakeT = Math.max(state.shakeT, SHAKE_ON_KILL);
  state.kills++;
  state.goldRun += GOLD_PER_KILL;
  addGold(GOLD_PER_KILL, "dungeon-game");
  if (state.fpsActive) {
    // Rampage kills build a streak (reset by a lull, tracked in fps.ts) and
    // punch the camera + extend the rampage a hair, so a hot streak feels like
    // a rolling wrecking-ball. No ult-charge (can't refuel itself).
    state.fpsStreak++;
    state.fpsStreakT = 0;
    state.fpsKick = Math.min(0.12, state.fpsKick + 0.05);
    state.fpsTimer += 0.4; // small reward: a good streak lasts a touch longer
    state.shakeT = Math.max(state.shakeT, 0.18);
    state.hitstopT = Math.max(state.hitstopT, 0.03); // a crisp micro-freeze per frag
    updateFpsStreak(state.fpsOverlayEl, state.fpsStreak);
  } else {
    // Charge the rampage ultimate from ordinary kills only.
    state.ultCharge = Math.min(1, state.ultCharge + ULT_CHARGE_PER_KILL);
  }
  state.hudDirty = true;
  sfxZombieDie();
}

/**
 * A zombie's bite connects. Damage routes through the armor (helmet first,
 * then chest) before touching hearts; absorbing costs those pieces
 * durability, and a piece worn to nothing is destroyed.
 */
export function hitPlayer(z: Zombie): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;
  if (p.iframes > 0 || p.shieldT > 0) return; // shield potion = untouchable

  // A brute's haymaker hits harder and shoves you further than a normal bite.
  const damage = z.kind === "brute" ? BRUTE_DAMAGE : ZOMBIE_DAMAGE;
  const knockback = z.kind === "brute" ? BRUTE_KNOCKBACK : KNOCKBACK_PLAYER;

  const absorbed = absorbDamage(state.gear, damage);
  state.gear = absorbed.gear;
  for (const slot of absorbed.destroyed) {
    showToast(`${GEAR[slot].icon} ${GEAR[slot].label.toUpperCase()} DESTROYED`);
    sfxBreak();
  }
  p.hp -= absorbed.hpDamage;

  p.iframes = PLAYER_IFRAMES;
  p.flashT = FLASH_TIME;
  p.sprite.setTint(0xff5555);
  if (absorbed.hpDamage > 0) state.vfx?.blood(p.x, 0.6, p.z, "red", 10);
  state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
  state.shakeT = absorbed.hpDamage > 0 ? 0.25 : 0.12; // armor soaks the flinch too
  state.hudDirty = true;
  sfxHurt();

  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const d = Math.hypot(dx, dz) || 1;
  const res = moveCircle(g, p.x, p.z, PLAYER_R, (dx / d) * knockback, (dz / d) * knockback);
  p.x = res.x;
  p.z = res.z;
  syncActorMesh(p);
  if (z.kind === "brute") state.shakeT = Math.max(state.shakeT, 0.35); // heavy slam
}

/**
 * A hostile projectile (the spitter's acid glob) lands on the player. Same
 * armor/i-frame/flash funnel as a bite, but no knockback source — just a
 * damage number and the impact point for the flinch direction.
 */
export function hitPlayerRanged(damage: number, srcX: number, srcZ: number): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0 || p.iframes > 0 || p.shieldT > 0) return; // shield blocks globs too

  const absorbed = absorbDamage(state.gear, damage);
  state.gear = absorbed.gear;
  for (const slot of absorbed.destroyed) {
    showToast(`${GEAR[slot].icon} ${GEAR[slot].label.toUpperCase()} DESTROYED`);
    sfxBreak();
  }
  p.hp -= absorbed.hpDamage;
  p.iframes = PLAYER_IFRAMES;
  p.flashT = FLASH_TIME;
  p.sprite.setTint(0x8fc46b); // acid-green flash, not the usual red bite
  if (absorbed.hpDamage > 0) state.vfx?.blood(p.x, 0.6, p.z, "green", 8);
  state.hitstopT = Math.max(state.hitstopT, HITSTOP_HIT);
  state.shakeT = Math.max(state.shakeT, absorbed.hpDamage > 0 ? 0.2 : 0.1);
  state.hudDirty = true;
  sfxHurt();

  // A small shove away from where the glob came from.
  const dx = p.x - srcX;
  const dz = p.z - srcZ;
  const d = Math.hypot(dx, dz) || 1;
  const res = moveCircle(g, p.x, p.z, PLAYER_R, (dx / d) * (KNOCKBACK_PLAYER * 0.5), (dz / d) * (KNOCKBACK_PLAYER * 0.5));
  p.x = res.x;
  p.z = res.z;
  syncActorMesh(p);
}

/** Tick a hit flash back toward untinted. Shared by player and zombies. */
export function updateFlash(a: { flashT: number; sprite: { setTint(hex: number | null): void } }, dt: number): void {
  if (a.flashT <= 0) return;
  a.flashT -= dt;
  if (a.flashT <= 0) a.sprite.setTint(null);
}
