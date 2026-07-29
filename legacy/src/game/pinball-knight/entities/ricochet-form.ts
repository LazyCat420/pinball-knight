/**
 * RICOCHET FORM — a few seconds where the ball stops being yours.
 *
 * Two things in the game want the same mechanic: the ⚡ storm marble's special
 * ("turn into a lightning bolt that bounces randomly around like crazy for 2-3
 * seconds") and the ✨ laser potion ("bounce off the walls rapidly but you
 * can't control it, it's just random"). They differ in flavour, speed and
 * damage — not in behaviour — so they are ONE subsystem with a `flavor` field
 * rather than two parallel implementations that drift.
 *
 * The design rule that makes it feel good rather than frustrating:
 *
 *   • INPUT IS IGNORED. Not dampened — ignored. A form that half-listens reads
 *     as broken controls; a form that plainly takes the wheel reads as a ride.
 *   • It is SHORT. Two to three seconds is long enough to be a spectacle and
 *     short enough that losing control is never a real threat.
 *   • You are INVULNERABLE for the duration. You cannot steer out of danger, so
 *     taking damage while unable to act would be pure punishment.
 *   • Every wall contact deflects RANDOMLY. A clean mirror reflection produces
 *     a tidy billiard path, which is the opposite of "bounces around like
 *     crazy" — the jitter is the effect.
 *
 * It owns the player the way the plunger and the trapdoor ride do:
 * `updateRicochet` returns true and `updatePlayer` returns early.
 */
import { state } from "../state";
import { moveCircle } from "../engine/collision";
import { damageZombie } from "./combat";
import { playerDamage } from "./combat";
import { PLAYER_R, ZOMBIE_R } from "../constants";
import {
  RICOCHET_DEFLECT_JITTER,
  RICOCHET_HIT_RADIUS,
  RICOCHET_TICK,
  RICOCHET_EXIT_SPEED,
  BOLT_DURATION,
  BOLT_SPEED,
  BOLT_DAMAGE,
  LASER_DURATION,
  LASER_SPEED,
  LASER_DAMAGE,
} from "../constants";
import { sfxBumper, sfxSpin } from "../audio";

export type RicochetFlavor = "bolt" | "laser";

interface FlavorSpec {
  duration: number;
  speed: number;
  damage: number;
  /** Trail / burst tint. */
  tint: number;
  /** The clip drawn while this form is up. */
  clip: "boltform" | "laserform";
  label: string;
  blurb: string;
  sfx: () => void;
}

export const RICOCHET_FLAVORS: Record<RicochetFlavor, FlavorSpec> = {
  bolt: {
    duration: BOLT_DURATION,
    speed: BOLT_SPEED,
    damage: BOLT_DAMAGE,
    tint: 0xfff3a0,
    clip: "boltform",
    label: "⚡ LIGHTNING",
    blurb: "you are the bolt — hold on",
    sfx: sfxBumper,
  },
  laser: {
    duration: LASER_DURATION,
    speed: LASER_SPEED,
    damage: LASER_DAMAGE,
    tint: 0xff5ad0,
    clip: "laserform",
    label: "✨ LASER",
    blurb: "no steering. no brakes.",
    sfx: sfxSpin,
  },
};

/** True while a ricochet form owns the player. */
export function inRicochetForm(): boolean {
  const p = state.player;
  return !!p && p.ricochetT > 0;
}

/** The active form's spec, or null. */
export function ricochetSpec(): FlavorSpec | null {
  const p = state.player;
  return p && p.ricochetT > 0 ? RICOCHET_FLAVORS[p.ricochetFlavor] : null;
}

/**
 * Enter the form. Safe to call while one is already running — it restarts,
 * which is what a second pickup should do.
 */
export function enterRicochetForm(flavor: RicochetFlavor): void {
  const p = state.player;
  if (!p) return;
  const spec = RICOCHET_FLAVORS[flavor];
  p.ricochetFlavor = flavor;
  p.ricochetT = spec.duration;
  p.ricochetTickT = 0;
  // Launch on the current heading if there is one; otherwise pick a direction,
  // because entering the form while standing still must not leave a stationary
  // "bouncing" ball sitting in place.
  const len = Math.hypot(p.momX, p.momZ);
  if (len < 1e-3) {
    const a = Math.random() * Math.PI * 2;
    p.momX = Math.cos(a);
    p.momZ = Math.sin(a);
  }
  p.momSpeed = spec.speed;
  state.vfx?.burst(p.x, 0.5, p.z, spec.tint, 24, 6);
  state.shakeT = Math.max(state.shakeT, 0.3);
  state.hitstopT = Math.max(state.hitstopT, 0.06);
  spec.sfx();
  state.hudDirty = true;
}

/**
 * Reflect off a wall with a large random deflection.
 *
 * A true mirror reflection makes a ball trace a neat, predictable billiard
 * path — legible, and completely wrong for this. The jitter is applied to the
 * REFLECTED angle rather than to the normal so the bounce still broadly
 * respects the wall it hit (a bolt that deflected INTO the wall would stick).
 */
function deflect(dirX: number, dirZ: number, nx: number, nz: number): { x: number; z: number } {
  // Mirror: d − 2(d·n)n
  const dot = dirX * nx + dirZ * nz;
  let rx = dirX - 2 * dot * nx;
  let rz = dirZ - 2 * dot * nz;
  const a = Math.atan2(rz, rx) + (Math.random() - 0.5) * RICOCHET_DEFLECT_JITTER;
  rx = Math.cos(a);
  rz = Math.sin(a);
  // If the jitter turned it back into the wall, mirror it about the normal
  // again — cheaper and more stable than rejection-sampling a valid angle.
  if (rx * nx + rz * nz < 0) {
    const d2 = rx * nx + rz * nz;
    rx -= 2 * d2 * nx;
    rz -= 2 * d2 * nz;
  }
  return { x: rx, z: rz };
}

/**
 * Advance the form. Returns true while it owns the player, in which case
 * `updatePlayer` must return immediately — no steering, no swings, no ride.
 */
export function updateRicochet(dt: number): boolean {
  const p = state.player;
  const g = state.grid;
  if (!p || !g || p.ricochetT <= 0) return false;
  const spec = RICOCHET_FLAVORS[p.ricochetFlavor];

  p.ricochetT = Math.max(0, p.ricochetT - dt);
  // Untouchable: you cannot steer out of trouble, so you cannot be punished
  // for being in it.
  p.iframes = Math.max(p.iframes, 0.2);

  // ── Move, bouncing off everything. Sub-stepped: at bolt speed a single 60Hz
  // step is over a tile long, and a swept move that clears a whole wall in one
  // frame would tunnel straight through the level.
  const steps = 3;
  const sub = dt / steps;
  for (let s = 0; s < steps; s++) {
    const step = spec.speed * sub;
    const res = moveCircle(g, p.x, p.z, PLAYER_R, p.momX * step, p.momZ * step);
    const stuck = Math.abs(res.x - (p.x + p.momX * step)) > 1e-3 || Math.abs(res.z - (p.z + p.momZ * step)) > 1e-3;
    p.x = res.x;
    p.z = res.z;
    if (stuck) {
      const n = res.hitN ?? { nx: -p.momX, nz: -p.momZ }; // headlong into a corner
      const d = deflect(p.momX, p.momZ, n.nx, n.nz);
      p.momX = d.x;
      p.momZ = d.z;
      state.vfx?.sparks(p.x, 0.4, p.z, n.nx, n.nz, 6);
      p.bounceCombo++; // it is still a rally — the combo should feel it
    }
  }
  p.momSpeed = spec.speed;

  // ── Damage everything it passes through, on a short shared cadence so a
  // single foe isn't hit sixty times a second.
  p.ricochetTickT -= dt;
  if (p.ricochetTickT <= 0) {
    p.ricochetTickT = RICOCHET_TICK;
    const reach = (PLAYER_R + ZOMBIE_R + RICOCHET_HIT_RADIUS) ** 2;
    for (const z of state.zombies) {
      if (z.mode === "dead") continue;
      if ((z.x - p.x) ** 2 + (z.z - p.z) ** 2 > reach) continue;
      damageZombie(z, playerDamage(spec.damage), p.momX, p.momZ, 1.2, false, "bounce");
    }
  }

  // ── The trail. This is most of what sells the form: a dense ribbon of
  // afterimages in the flavour's hue.
  state.vfx?.ghost(p.sprite.mesh, spec.tint, 0.22, 0.55);

  if (p.ricochetT === 0) {
    // Hand back control as a fast ride rather than a dead stop — being frozen
    // in place the instant it ends would waste the speed it built.
    p.momSpeed = RICOCHET_EXIT_SPEED;
    state.vfx?.burst(p.x, 0.5, p.z, spec.tint, 14, 4);
    state.hudDirty = true;
  }
  return true;
}
