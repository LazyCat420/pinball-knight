/**
 * Projectile Muzzle & Launch VFX.
 *
 * Emits directional muzzle flashes, ignition cones, spark showers, and smoke
 * wisps at monster mouths or firearm barrels when attacks are released.
 */
import { state } from "../../state";
import { PROJECTILE_Y, MUZZLE_OFFSET } from "../../constants/enemies";
import { getProjectileVfxConfig } from "./registry";

export function triggerMuzzleVfx(
  x: number,
  z: number,
  dx: number,
  dz: number,
  kindOrKey: string,
  y: number = PROJECTILE_Y,
): void {
  if (!state.scene || !state.vfx) return;
  const config = getProjectileVfxConfig(kindOrKey);
  const flash = config.launch?.muzzleFlash ?? false;
  const sparkCount = config.launch?.sparkCount ?? (flash ? 4 : 0);
  if (!flash && sparkCount === 0 && !config.launch?.smokePuff) return;

  const sx = x + dx * (MUZZLE_OFFSET * 0.7);
  const sz = z + dz * (MUZZLE_OFFSET * 0.7);
  const color = config.launch?.flashColor ?? config.colors.glow ?? 0xfef08a;

  // Flash burst
  if (flash) {
    state.vfx.burst?.(sx, y, sz, color, 4, 1.2);
  }

  // Directional sparks
  if (sparkCount > 0) {
    state.vfx.sparks?.(sx, y, sz, dx * 1.5, dz * 1.5, sparkCount);
  }

  // Smoke puff
  if (config.launch?.smokePuff) {
    state.vfx.smoke?.(sx, y, sz, 0.4, 0.15);
  }
}
