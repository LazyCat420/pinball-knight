/**
 * Hit resolution — damage, i-frames, knockback, durability and death all
 * resolve HERE, in one place, rather than being smeared across player.ts and
 * zombie.ts.
 */
import { state, type Zombie } from "../state";
import {
  KNOCKBACK_ZOMBIE,
  KNOCKBACK_PLAYER,
  PLAYER_IFRAMES,
  ZOMBIE_DAMAGE,
  ZOMBIE_R,
  PLAYER_R,
  GOLD_PER_KILL,
  PPU,
} from "../constants";
import { moveCircle } from "../collision";
import type { Facing } from "../render/animator";
import { addGold } from "../../../utils/gold-wallet";
import { WEAPONS, GEAR, degradeWeapon, absorbDamage } from "../items";
import { sfxHit, sfxZombieDie, sfxHurt, sfxBreak } from "../audio";
import { showToast } from "../ui";

export const FACING_VEC: Record<Facing, [number, number]> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

const FLASH_TIME = 0.12;

/** Snap an actor's mesh to its logical position, on the render-target pixel
 * grid — unsnapped sprites shimmer as they move (BLUEPRINT §4.3). */
export function syncActorMesh(a: { sprite: { mesh: { position: { set(x: number, y: number, z: number): void } } }; x: number; z: number }): void {
  a.sprite.mesh.position.set(Math.round(a.x * PPU) / PPU, 0, Math.round(a.z * PPU) / PPU);
}

/**
 * The player's swing lands, with whatever is in hand: range, arc and damage
 * come from the equipped weapon, and a swing that CONNECTS costs a point of
 * durability. Weapons break on use — the swing that breaks the chair still
 * hits with the chair.
 */
export function resolvePlayerAttack(): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return false;

  const w = WEAPONS[state.weapon.id];
  const [fx, fz] = FACING_VEC[p.facing];
  let landed = false;

  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > w.range) continue;
    // At point-blank range the arc test divides by ~0 — inside the bodies'
    // combined radius it's a hit no matter the angle.
    if (d > PLAYER_R + ZOMBIE_R) {
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < w.arcCos) continue;
    }

    landed = true;
    z.hp -= w.damage;
    z.aggro = true; // hitting a dormant zombie certainly wakes it
    z.flashT = FLASH_TIME;
    z.sprite.setTint(0xff6a6a);

    // Knockback along the swing, wall-aware. Heavier weapons shove harder.
    const push = KNOCKBACK_ZOMBIE * (1 + (w.damage - 1) * 0.35);
    const kx = (d > 1e-4 ? dx / d : fx) * push;
    const kz = (d > 1e-4 ? dz / d : fz) * push;
    const res = moveCircle(g, z.x, z.z, ZOMBIE_R, kx, kz);
    z.x = res.x;
    z.z = res.z;
    syncActorMesh(z);

    if (z.hp <= 0) {
      killZombie(z);
    } else {
      sfxHit();
    }
  }

  if (landed) {
    const worn = degradeWeapon(state.weapon);
    state.weapon = worn.weapon;
    if (worn.broke) {
      sfxBreak();
      showToast(`${w.icon} ${w.label.toUpperCase()} BROKE`, "fists it is");
    }
    state.hudDirty = true;
  }

  return landed;
}

function killZombie(z: Zombie): void {
  z.mode = "dead";
  z.anim.play("death", { force: true });
  state.kills++;
  state.goldRun += GOLD_PER_KILL;
  addGold(GOLD_PER_KILL, "dungeon-game");
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
  if (p.iframes > 0) return;

  const absorbed = absorbDamage(state.gear, ZOMBIE_DAMAGE);
  state.gear = absorbed.gear;
  for (const slot of absorbed.destroyed) {
    showToast(`${GEAR[slot].icon} ${GEAR[slot].label.toUpperCase()} DESTROYED`);
    sfxBreak();
  }
  p.hp -= absorbed.hpDamage;

  p.iframes = PLAYER_IFRAMES;
  p.flashT = FLASH_TIME;
  p.sprite.setTint(0xff5555);
  state.shakeT = absorbed.hpDamage > 0 ? 0.25 : 0.12; // armor soaks the flinch too
  state.hudDirty = true;
  sfxHurt();

  const dx = p.x - z.x;
  const dz = p.z - z.z;
  const d = Math.hypot(dx, dz) || 1;
  const res = moveCircle(g, p.x, p.z, PLAYER_R, (dx / d) * KNOCKBACK_PLAYER, (dz / d) * KNOCKBACK_PLAYER);
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
