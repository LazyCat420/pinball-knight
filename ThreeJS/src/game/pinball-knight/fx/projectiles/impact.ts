/**
 * Projectile Impact VFX.
 *
 * Emits wall ricochets, explosive blasts, caustic splashes, floor hazard decals,
 * and camera micro-shakes when projectiles connect with surfaces or entities.
 */
import { state, type Projectile, type FloorFxKind } from "../../state";
import { PROJECTILE_Y } from "../../constants/enemies";
import { spawnFloorFx } from "../../entities/floor-fx";
import { getProjectileVfxConfig } from "./registry";

export function triggerImpactVfx(
  x: number,
  z: number,
  pr: Projectile,
  surface: "wall" | "entity",
  y: number = PROJECTILE_Y,
): void {
  if (!state.scene || !state.vfx) return;
  const config = getProjectileVfxConfig(pr.kind);
  const impact = config.impact;

  const color = impact.color;
  const count = impact.count ?? (surface === "entity" ? 6 : 8);

  switch (impact.wallType) {
    case "sparks":
      state.vfx.sparks?.(x, y, z, -pr.vx * 0.05, -pr.vz * 0.05, count);
      break;
    case "burst":
      state.vfx.burst?.(x, y, z, color, count, 1.4);
      break;
    case "splash":
      state.vfx.burst?.(x, y, z, color, count, 1.2);
      state.vfx.dust?.(x, y, z);
      break;
    case "detonate":
      state.vfx.burst?.(x, y, z, color, count, 2.2);
      state.vfx.sparks?.(x, y, z, 0, 1.5, 10);
      state.vfx.smoke?.(x, y, z, 0.8, 0.3);
      break;
  }

  // Persistent floor hazard decal
  if (impact.floorDecal) {
    spawnFloorFx(impact.floorDecal as FloorFxKind, x, z, 1.2, 4.0, true);
  }

  // Camera recoil shake
  if (impact.screenShake && surface === "wall") {
    state.shakeT = Math.max(state.shakeT, impact.screenShake);
  }
}
