/**
 * Zombies — slow, dumb, numerous. Threatening in a group, trivial alone.
 *
 * Pathing: each zombie walks downhill on the shared BFS flow field that core.ts
 * recomputes every FLOW_INTERVAL. Within a couple of tiles it steers straight
 * at the player instead (the field only knows tile centres, and door-frame
 * shuffling at close range looks robotic). A cheap pairwise separation shove
 * keeps the horde from stacking into a single sprite.
 */
import { state, type Zombie } from "../state";
import {
  ZOMBIE_R,
  ZOMBIE_CONTACT_RANGE,
  ZOMBIE_ATTACK_WINDUP,
  ZOMBIE_ATTACK_COOLDOWN,
  AGGRO_TILES,
  SEPARATION_R,
} from "../constants";
import { moveCircle } from "../collision";
import { worldToTile, tileCenter, idx } from "../maze/generator";
import { flowStep } from "./ai";
import { facingFromVelocity, type Facing } from "../render/animator";
import { worldDirToScreen } from "../camera";
import { hitPlayer, syncActorMesh, updateFlash } from "./combat";
import { sfxGroan } from "../audio";

/** World velocity → the facing the ART thinks in (screen-relative). */
function facingFromWorld(wx: number, wz: number, fallback: Facing): Facing {
  const s = worldDirToScreen(wx, wz);
  return facingFromVelocity(s.x, s.z, fallback);
}

/** Straight-line pursuit inside this range; flow field beyond it. */
const DIRECT_STEER_RANGE = 1.6;

/** One groan per window, not one per zombie — a chorus is just noise. */
let _groanCooldown = 0;

export function updateZombies(dt: number): void {
  const g = state.grid;
  const p = state.player;
  if (!g || !p) return;

  _groanCooldown = Math.max(0, _groanCooldown - dt);

  for (const z of state.zombies) {
    updateFlash(z, dt);
    if (z.mode === "dead") continue; // the death clip plays out; the corpse stays

    z.cooldown = Math.max(0, z.cooldown - dt);
    z.burnT = Math.max(0, z.burnT - dt); // flame-tick immunity window

    // ── Aggro ──
    if (!z.aggro && state.flowField) {
      const t = worldToTile(g, z.x, z.z);
      const d = state.flowField[idx(g, t.i, t.j)];
      if (d >= 0 && d <= AGGRO_TILES) {
        z.aggro = true;
        if (_groanCooldown <= 0) {
          _groanCooldown = 1.2;
          sfxGroan();
        }
      }
    }
    if (!z.aggro) {
      z.mode = "idle";
      z.anim.play("idle");
      continue;
    }

    const pdx = p.x - z.x;
    const pdz = p.z - z.z;
    const pdist = Math.hypot(pdx, pdz);

    // ── Bite windup: rooted, facing you, then the bite lands if you're still there ──
    if (z.mode === "windup") {
      z.windupT += dt;
      z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
      z.anim.play("idle"); // the stillness IS the tell
      if (z.windupT >= ZOMBIE_ATTACK_WINDUP) {
        z.mode = "chase";
        z.cooldown = ZOMBIE_ATTACK_COOLDOWN;
        if (pdist <= ZOMBIE_CONTACT_RANGE * 1.3 && p.hp > 0) hitPlayer(z);
      }
      continue;
    }

    z.mode = "chase";
    if (pdist <= ZOMBIE_CONTACT_RANGE && z.cooldown <= 0 && p.hp > 0) {
      z.mode = "windup";
      z.windupT = 0;
      continue;
    }

    // ── Steering ──
    let vx = 0;
    let vz = 0;
    if (pdist <= DIRECT_STEER_RANGE) {
      if (pdist > 1e-4) {
        vx = pdx / pdist;
        vz = pdz / pdist;
      }
    } else if (state.flowField) {
      const t = worldToTile(g, z.x, z.z);
      const next = flowStep(g, state.flowField, t.i, t.j);
      if (next) {
        const c = tileCenter(g, next.i, next.j);
        const dx = c.x - z.x;
        const dz = c.z - z.z;
        const d = Math.hypot(dx, dz) || 1;
        vx = dx / d;
        vz = dz / d;
      }
    }

    // ── Separation — shove apart any living neighbours that overlap ──
    let sx = 0;
    let sz = 0;
    for (const other of state.zombies) {
      if (other === z || other.mode === "dead") continue;
      const dx = z.x - other.x;
      const dz = z.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4 && d < SEPARATION_R) {
        const push = (SEPARATION_R - d) / SEPARATION_R;
        sx += (dx / d) * push;
        sz += (dz / d) * push;
      }
    }

    const mx = (vx * z.speed + sx * 1.5) * dt;
    const mz = (vz * z.speed + sz * 1.5) * dt;
    if (mx !== 0 || mz !== 0) {
      const res = moveCircle(g, z.x, z.z, ZOMBIE_R, mx, mz);
      z.x = res.x;
      z.z = res.z;
    }

    if (vx !== 0 || vz !== 0) {
      z.anim.setFacing(facingFromWorld(vx, vz, "S"));
      z.anim.play("walk");
    } else {
      z.anim.play("idle");
    }

    syncActorMesh(z);
  }
}
