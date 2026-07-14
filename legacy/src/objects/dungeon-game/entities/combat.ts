/**
 * Hit resolution — damage, i-frames, knockback and death all resolve HERE, in
 * one place, rather than being smeared across player.ts and zombie.ts.
 */
import { state, type Zombie } from "../state";
import {
  ATTACK_RANGE,
  ATTACK_ARC_COS,
  ATTACK_DAMAGE,
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
import { sfxHit, sfxZombieDie, sfxHurt } from "../audio";

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
 * The player's swing lands: everything living within ATTACK_RANGE and inside
 * the ±60° arc of the facing direction takes damage. Returns true if anything
 * was hit (used for hit-stop feel later, and it's honest telemetry).
 */
export function resolvePlayerAttack(): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g) return false;

  const [fx, fz] = FACING_VEC[p.facing];
  let landed = false;

  for (const z of state.zombies) {
    if (z.mode === "dead") continue;
    const dx = z.x - p.x;
    const dz = z.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > ATTACK_RANGE) continue;
    // At point-blank range the arc test divides by ~0 — inside the bodies'
    // combined radius it's a hit no matter the angle.
    if (d > PLAYER_R + ZOMBIE_R) {
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < ATTACK_ARC_COS) continue;
    }

    landed = true;
    z.hp -= ATTACK_DAMAGE;
    z.aggro = true; // hitting a dormant zombie certainly wakes it
    z.flashT = FLASH_TIME;
    z.sprite.setTint(0xff6a6a);

    // Knockback along the swing, wall-aware.
    const kx = (d > 1e-4 ? dx / d : fx) * KNOCKBACK_ZOMBIE;
    const kz = (d > 1e-4 ? dz / d : fz) * KNOCKBACK_ZOMBIE;
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

/** A zombie's bite connects. Respects i-frames; shoves the player back. */
export function hitPlayer(z: Zombie): void {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.hp <= 0) return;
  if (p.iframes > 0) return;

  p.hp -= ZOMBIE_DAMAGE;
  p.iframes = PLAYER_IFRAMES;
  p.flashT = FLASH_TIME;
  p.sprite.setTint(0xff5555);
  state.shakeT = 0.25;
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
