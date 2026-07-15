/**
 * Zombies — slow, dumb, numerous. Threatening in a group, trivial alone.
 *
 * Pathing: each zombie walks downhill on the shared BFS flow field that core.ts
 * recomputes every FLOW_INTERVAL. Within a couple of tiles it steers straight
 * at the player instead (the field only knows tile centres, and door-frame
 * shuffling at close range looks robotic). A cheap pairwise separation shove
 * keeps the horde from stacking into a single sprite.
 */
import { state, type Zombie, type EnemyKind } from "../state";
import {
  ZOMBIE_R,
  ZOMBIE_CONTACT_RANGE,
  ZOMBIE_ATTACK_WINDUP,
  ZOMBIE_ATTACK_COOLDOWN,
  SPIDER_R,
  SPIDER_CONTACT_RANGE,
  SPIDER_ATTACK_WINDUP,
  SPIDER_ATTACK_COOLDOWN,
  BRUTE_R,
  BRUTE_CONTACT_RANGE,
  BRUTE_ATTACK_WINDUP,
  BRUTE_ATTACK_COOLDOWN,
  SPITTER_R,
  SPITTER_WINDUP,
  SPITTER_COOLDOWN,
  SPITTER_FIRE_RANGE,
  SPITTER_KITE_RANGE,
  AGGRO_TILES,
  SEPARATION_R,
} from "../constants";
import { moveCircle } from "../collision";
import { worldToTile, tileCenter, idx } from "../maze/generator";
import { flowStep } from "./ai";
import { facingFromVelocity, type Facing } from "../render/animator";
import { worldDirToScreen } from "../camera";
import { hitPlayer, syncActorMesh, updateFlash } from "./combat";
import { spitGlob } from "./projectiles";
import { sfxGroan } from "../audio";

/** Per-family combat tuning, looked up once per zombie per frame. */
interface EnemyStats {
  bodyR: number;
  contactRange: number;
  windup: number;
  cooldown: number;
  ranged: boolean; // spitter: attacks from afar instead of biting
}
const STATS: Record<EnemyKind, EnemyStats> = {
  zombie: { bodyR: ZOMBIE_R, contactRange: ZOMBIE_CONTACT_RANGE, windup: ZOMBIE_ATTACK_WINDUP, cooldown: ZOMBIE_ATTACK_COOLDOWN, ranged: false },
  spider: { bodyR: SPIDER_R, contactRange: SPIDER_CONTACT_RANGE, windup: SPIDER_ATTACK_WINDUP, cooldown: SPIDER_ATTACK_COOLDOWN, ranged: false },
  brute: { bodyR: BRUTE_R, contactRange: BRUTE_CONTACT_RANGE, windup: BRUTE_ATTACK_WINDUP, cooldown: BRUTE_ATTACK_COOLDOWN, ranged: false },
  spitter: { bodyR: SPITTER_R, contactRange: SPITTER_FIRE_RANGE, windup: SPITTER_WINDUP, cooldown: SPITTER_COOLDOWN, ranged: true },
};

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

    // Per-family combat feel (bite range, windup, cooldown, body size, whether
    // it attacks at range) comes from the STATS table.
    const st = STATS[z.kind];
    const { contactRange, windup, bodyR } = st;
    const attackCooldown = st.cooldown;
    const ranged = st.ranged;

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

    // ── Attack windup: rooted, facing you. A melee kind bites when the windup
    // completes; a spitter (ranged) launches an acid glob instead. ──
    if (z.mode === "windup") {
      z.windupT += dt;
      z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
      z.anim.play(ranged ? "attack" : "idle"); // spitter shows its rear-back clip
      if (z.windupT >= windup) {
        z.mode = "chase";
        z.cooldown = attackCooldown;
        if (p.hp > 0) {
          if (ranged) {
            if (pdist > 1e-4) spitGlob(z.x, z.z, pdx / pdist, pdz / pdist);
          } else if (pdist <= contactRange * 1.3) {
            hitPlayer(z);
          }
        }
      }
      continue;
    }

    z.mode = "chase";
    // Melee bites in contact range; a spitter fires from anywhere in its long
    // fire range (contactRange for it is SPITTER_FIRE_RANGE).
    if (pdist <= contactRange && z.cooldown <= 0 && p.hp > 0) {
      z.mode = "windup";
      z.windupT = 0;
      continue;
    }

    // ── Steering ──
    // A spitter KITES: too close → back away to keep firing distance; in the
    // sweet spot → hold and shoot; too far → path in via the flow field like
    // any other enemy.
    let vx = 0;
    let vz = 0;
    if (ranged) {
      if (pdist < SPITTER_KITE_RANGE && pdist > 1e-4) {
        vx = -pdx / pdist; // retreat
        vz = -pdz / pdist;
      } else if (pdist <= contactRange) {
        // in fire range and not too close: hold position and shoot
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
    } else if (pdist <= DIRECT_STEER_RANGE) {
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
      const res = moveCircle(g, z.x, z.z, bodyR, mx, mz);
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
