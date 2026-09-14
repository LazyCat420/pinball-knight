/**
 * Projectile In-Flight Visual Dynamics Updater.
 *
 * Runs per-frame in `updateProjectiles(dt)` to advance visual heading orientation,
 * axis spin, pulsing glow, fuse burn countdowns, and trail particle emissions.
 */
import { state, type Projectile } from "../../state";
import { PROJECTILE_Y } from "../../constants/enemies";
import { getProjectileVfxConfig } from "./registry";

// Internal timer state attached dynamically to live projectiles
interface ProjectileWithVfxState extends Projectile {
  _vfxTrailTimer?: number;
}

/**
 * Updates the visual representation of a projectile during flight.
 */
export function updateProjectileVfx(pr: Projectile, dt: number): void {
  const p = pr as ProjectileWithVfxState;
  const config = getProjectileVfxConfig(pr.kind);

  // 1. Heading Alignment
  if (config.flight.orientToHeading) {
    if (Math.hypot(pr.vx, pr.vz) > 1e-4) {
      pr.mesh.rotation.y = Math.atan2(pr.vx, pr.vz);
    }
  }

  // 2. Axis Spin / Tumble
  if (config.flight.spinAxis && config.flight.spinSpeed) {
    const delta = dt * config.flight.spinSpeed;
    switch (config.flight.spinAxis) {
      case "y":
      case "yaw":
        pr.mesh.rotation.y += delta;
        break;
      case "x":
      case "pitch":
        pr.mesh.rotation.x += delta;
        break;
      case "z":
      case "roll":
        pr.mesh.rotation.z += delta;
        break;
    }
  }

  // 3. Pulse Glow / Scale Breathing
  if (config.flight.pulseGlow) {
    const pulseSpeed = config.flight.pulseSpeed ?? 14;
    const pulse = 1 + Math.sin(pr.life * pulseSpeed) * 0.14;
    pr.mesh.scale.setScalar(pulse);
  }

  // 4. Fuse Burn & Urgency Pulsing for Bombs
  if (config.archetype === "bomb") {
    const burn = 1 - pr.life / pr.maxLife;
    const yPos = pr.mesh.position.y || PROJECTILE_Y;
    state.vfx?.sparks(pr.x, yPos + 0.12, pr.z, -pr.vx * 0.02, -pr.vz * 0.02, burn > 0.66 ? 2 : 1);
    pr.mesh.scale.setScalar(1 + Math.max(0, burn - 0.6) * 0.9);
  }

  // 5. In-Flight Trail Particles
  if (config.flight.trailType && state.vfx) {
    const interval = config.flight.trailInterval ?? 0.04;
    p._vfxTrailTimer = (p._vfxTrailTimer ?? 0) + dt;

    if (p._vfxTrailTimer >= interval) {
      p._vfxTrailTimer = 0;
      const py = pr.mesh.position.y || PROJECTILE_Y;
      const count = config.flight.trailCount ?? 1;

      switch (config.flight.trailType) {
        case "sparks":
          state.vfx.sparks(pr.x, py, pr.z, -pr.vx * 0.02, -pr.vz * 0.02, count);
          break;
        case "smoke":
          state.vfx.smoke(pr.x, py, pr.z, count * 0.3, 0.1);
          break;
        case "embers":
          state.vfx.ember(pr.x, py, pr.z);
          break;
        case "caustic":
        case "dust":
          state.vfx.dust(pr.x, py, pr.z);
          break;
        case "laser":
          state.vfx.laserMark(pr.x, py, pr.z, pr.vx, pr.vz, config.colors.glow ?? 0x67e8f9, 0.25);
          break;
        case "stream":
          state.vfx.sparks(pr.x, py, pr.z, -pr.vx * 0.015, -pr.vz * 0.015, count);
          break;
      }
    }
  }
}
