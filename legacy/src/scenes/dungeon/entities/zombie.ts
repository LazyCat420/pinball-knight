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
  GHOST_R,
  GHOST_CONTACT_RANGE,
  GHOST_ATTACK_WINDUP,
  GHOST_ATTACK_COOLDOWN,
  GHOST_HOVER_Y,
  GHOST_BOB_AMP,
  GHOST_BOB_SPEED,
  BAT_R,
  BAT_CONTACT_RANGE,
  BAT_ATTACK_WINDUP,
  BAT_ATTACK_COOLDOWN,
  BAT_WOBBLE_AMP,
  BAT_WOBBLE_FREQ,
  BAT_HOVER_Y,
  SLIME_R,
  SLIME_CONTACT_RANGE,
  SLIME_ATTACK_WINDUP,
  SLIME_ATTACK_COOLDOWN,
  REAPER_CONTACT_RANGE,
  REAPER_ATTACK_WINDUP,
  REAPER_ATTACK_COOLDOWN,
  REAPER_SPEED_RAMP,
  REAPER_SPEED_MAX,
  REAPER_TINT,
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
  ghost: { bodyR: GHOST_R, contactRange: GHOST_CONTACT_RANGE, windup: GHOST_ATTACK_WINDUP, cooldown: GHOST_ATTACK_COOLDOWN, ranged: false },
  bat: { bodyR: BAT_R, contactRange: BAT_CONTACT_RANGE, windup: BAT_ATTACK_WINDUP, cooldown: BAT_ATTACK_COOLDOWN, ranged: false },
  slime: { bodyR: SLIME_R, contactRange: SLIME_CONTACT_RANGE, windup: SLIME_ATTACK_WINDUP, cooldown: SLIME_ATTACK_COOLDOWN, ranged: false },
  reaper: { bodyR: GHOST_R, contactRange: REAPER_CONTACT_RANGE, windup: REAPER_ATTACK_WINDUP, cooldown: REAPER_ATTACK_COOLDOWN, ranged: false },
};

/** World velocity → the facing the ART thinks in (screen-relative). */
function facingFromWorld(wx: number, wz: number, fallback: Facing): Facing {
  const s = worldDirToScreen(wx, wz);
  return facingFromVelocity(s.x, s.z, fallback);
}

// Attack-telegraph colours: melee bites flash hot red-orange (the "it's about to
// bite" tell), the spitter's ranged gob flashes acid-green to match its glob.
const TELL_MELEE = 0xff7a2a;
const TELL_RANGED = 0x8fc46b;
/** Blend white (no tint) → a warning colour by k∈0..1; k grows across the windup. */
function lerpTint(target: number, k: number): number {
  const tr = (target >> 16) & 0xff;
  const tg = (target >> 8) & 0xff;
  const tb = target & 0xff;
  // start from white (0xffffff = unmodified) so the pulse eases IN from neutral
  const r = Math.round(255 + (tr - 255) * k);
  const gg = Math.round(255 + (tg - 255) * k);
  const b = Math.round(255 + (tb - 255) * k);
  return (r << 16) | (gg << 8) | b;
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

    // ── GHOST / REAPER ── float STRAIGHT AT the player THROUGH walls (no flow
    // field, no moveCircle, no separation), hovering with a bob. Their own
    // self-contained update so none of the grounded steering applies. The
    // REAPER additionally accelerates FOREVER — the floor timer closing in.
    if (z.kind === "ghost" || z.kind === "reaper") {
      if (z.kind === "reaper") z.speed = Math.min(REAPER_SPEED_MAX, z.speed + REAPER_SPEED_RAMP * dt);
      updateGhost(z, dt);
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

      // TELEGRAPH: pulse the body toward its attack colour across the windup, so
      // the bite is READABLE and a well-timed dodge-roll's i-frames can pass
      // through it (the "roll into the attack" skill). The pulse ramps up as the
      // strike nears — a brute's slow haymaker glows longest, a spider's snappy
      // bite barely flickers, matching each family's windup length. A live hit
      // flash (flashT) owns the tint, so don't fight it.
      if (z.flashT <= 0) {
        const k = Math.min(1, z.windupT / Math.max(windup, 1e-4));
        const warn = ranged ? TELL_RANGED : TELL_MELEE;
        z.sprite.setTint(lerpTint(warn, k));
      }

      if (z.windupT >= windup) {
        z.mode = "chase";
        z.cooldown = attackCooldown;
        if (z.flashT <= 0) z.sprite.setTint(null); // drop the telegraph on release
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
    // Left windup without releasing (player fled out of range): clear any tell.
    if (z.flashT <= 0) z.sprite.setTint(null);

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

    // ── BAT wobble ── a sine weave ACROSS the flight line so it's hard to
    // line up a swing on: perturb the steer direction with a perpendicular
    // oscillation (still wall-bound via moveCircle — it flies the corridors).
    if (z.kind === "bat" && (vx !== 0 || vz !== 0)) {
      z.bobT = (z.bobT ?? 0) + dt;
      const w = Math.sin(z.bobT * BAT_WOBBLE_FREQ) * BAT_WOBBLE_AMP;
      const px = -vz * w;
      const pz = vx * w;
      const len = Math.hypot(vx + px, vz + pz) || 1;
      vx = (vx + px) / len;
      vz = (vz + pz) / len;
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
    // A bat FLIES: lift its billboard off the floor with a quick flutter-bob.
    if (z.kind === "bat") {
      z.sprite.mesh.position.y = BAT_HOVER_Y + Math.sin((z.bobT ?? 0) * 9) * 0.06;
    }
  }
}

/**
 * The GHOST update (also the REAPER — same spectral drift, meaner numbers):
 * drift STRAIGHT toward the player through walls (no maze pathing, no
 * collision), hovering with a gentle bob. It still winds up and lands a
 * chilling touch in contact range, reusing the same telegraph pulse.
 * Self-contained — called in place of all the grounded steering above.
 */
function updateGhost(z: Zombie, dt: number): void {
  const p = state.player;
  if (!p) return;
  const st = STATS[z.kind];
  // The reaper's resting look is blood-red, not untinted — every place the
  // ghost path clears its telegraph tint, the reaper re-dyes instead.
  const baseTint = z.kind === "reaper" ? REAPER_TINT : null;
  const pdx = p.x - z.x;
  const pdz = p.z - z.z;
  const pdist = Math.hypot(pdx, pdz);

  z.bobT = (z.bobT ?? 0) + dt;

  // ── Windup: reach out, then the touch lands. Same telegraph as the melee kinds. ──
  if (z.mode === "windup") {
    z.windupT += dt;
    z.anim.setFacing(facingFromWorld(pdx, pdz, "S"));
    z.anim.play("idle");
    if (z.flashT <= 0) {
      const k = Math.min(1, z.windupT / Math.max(st.windup, 1e-4));
      z.sprite.setTint(lerpTint(TELL_MELEE, k));
    }
    if (z.windupT >= st.windup) {
      z.mode = "chase";
      z.cooldown = st.cooldown;
      if (z.flashT <= 0) z.sprite.setTint(baseTint);
      if (p.hp > 0 && pdist <= st.contactRange * 1.3) hitPlayer(z);
    }
    syncGhostMesh(z);
    return;
  }
  if (z.flashT <= 0) z.sprite.setTint(baseTint);

  // Enter windup in contact range; otherwise drift straight in (through walls).
  z.mode = "chase";
  if (pdist <= st.contactRange && z.cooldown <= 0 && p.hp > 0) {
    z.mode = "windup";
    z.windupT = 0;
    syncGhostMesh(z);
    return;
  }

  if (pdist > 1e-4) {
    const nx = pdx / pdist;
    const nz = pdz / pdist;
    // NO moveCircle — the ghost passes through walls. Just integrate position.
    z.x += nx * z.speed * dt;
    z.z += nz * z.speed * dt;
    z.anim.setFacing(facingFromWorld(nx, nz, "S"));
  }
  z.anim.play("walk");
  syncGhostMesh(z);
}

/**
 * Position a ghost's billboard: the shared iso transform, then LIFT it off the
 * floor to GHOST_HOVER_Y plus a sine bob so it visibly floats. syncActorMesh
 * pins y=0; we override just the y after it runs.
 */
function syncGhostMesh(z: Zombie): void {
  syncActorMesh(z);
  const bob = Math.sin((z.bobT ?? 0) * GHOST_BOB_SPEED) * GHOST_BOB_AMP;
  z.sprite.mesh.position.y = GHOST_HOVER_Y + bob;
}
