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
 * WHERE THE TWO FLAVOURS DIVERGE — and it is only in how they read, not in what
 * they do. Bouncing off walls is not enough to make the ✨ laser look like one:
 * between two walls the path is a straight line, and at LASER_SPEED that drew as
 * a long beam sliding sideways across the room. So the laser also KINKS in
 * mid-air (`zigPeriod`) and stamps a cross at every corner (`vfx.laserMark`),
 * which turns it into a dot darting along a zigzag, punching out laser crosses.
 * The ⚡ bolt keeps the straight legs and the long ribbon: it is a thing being
 * thrown around a room, and the smooth arc between bounces is its read.
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
  LASER_ZIG_PERIOD,
  LASER_ZIG_ANGLE,
  LASER_MARK_STEP,
  LASER_TRAIL_LIFE,
} from "../constants";
import { sfxBumper, sfxSpin } from "../audio";

/**
 * Height the trail is drawn at. Chest height rather than the floor: the ribbon
 * should read as the ball's own path through the air, and at y≈0 it looked like
 * a scorch mark painted on the ground.
 */
const TRAIL_Y = 0.45;

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
  /**
   * ── THE ZIGZAG ──
   * Seconds between mid-air heading kinks; 0 means the form travels straight
   * between walls. Only the laser kinks, and that is the whole difference in
   * how the two read: the bolt is a thing being BOUNCED around the room, the
   * laser is a point of light DARTING, which needs corners the walls cannot
   * supply often enough. See LASER_ZIG_PERIOD for why straight was wrong.
   */
  zigPeriod: number;
  /** Kink size in radians, sign alternating (see LASER_ZIG_ANGLE). */
  zigAngle: number;
  /** World units between stamped laser crosses; 0 stamps none. */
  markStep: number;
  /** How long each trail point lives — the length of the tail it drags. */
  trailLife: number;
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
    // The bolt keeps the long unbroken ribbon: it is being thrown around the
    // room by the walls, and a smooth arc between two bounces is the read.
    zigPeriod: 0,
    zigAngle: 0,
    markStep: 0,
    trailLife: 0.45,
  },
  laser: {
    duration: LASER_DURATION,
    speed: LASER_SPEED,
    damage: LASER_DAMAGE,
    /**
     * BLOOD LIGHT (palette entry 13), not the free-hand magenta this was.
     *
     * Everything drawn here goes through the screen-space palette snap, and
     * that snap is LUMA-WEIGHTED against 32 entries with no magenta in them.
     * Shot on a real adapter, 0xff5ad0 brightened past the quantiser's midpoint
     * landed on STEEL — the cross chain came out grey. 13 is the palette's only
     * hot pink and is what render/cel-painter.ts already names as the laser's
     * colour; being an exact entry, it snaps to itself.
     */
    tint: 0xd95763,
    clip: "laserform",
    label: "✨ LASER",
    blurb: "no steering. no brakes.",
    sfx: sfxSpin,
    zigPeriod: LASER_ZIG_PERIOD,
    zigAngle: LASER_ZIG_ANGLE,
    markStep: LASER_MARK_STEP,
    trailLife: LASER_TRAIL_LIFE,
  },
};

/**
 * Zigzag + stamp bookkeeping. Module-local rather than player state because
 * there is exactly one player and exactly one form, both are reset by
 * `enterRicochetForm`, and neither belongs in a saved run.
 */
let zigT = 0;
/** Flipped every kink so the heading SAWS instead of drifting. */
let zigSign = 1;
/** Distance travelled since the last stamped cross. */
let markD = 0;

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
  zigT = spec.zigPeriod;
  zigSign = Math.random() < 0.5 ? 1 : -1;
  markD = 0;
  // A fresh form must not inherit the previous one's tail — the trail is a
  // keep-alive ribbon, not a per-cast object.
  state.vfx?.trailClear();
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
    // ── THE ZIGZAG. Kink the heading BEFORE the move, so the corner lands at
    // the position the mark is stamped at. The sign alternates, which is the
    // difference between a saw-tooth that still crosses the room and a random
    // walk that mills around in one spot; the magnitude is jittered so the
    // path is not a machined chevron.
    if (spec.zigPeriod > 0) {
      zigT -= sub;
      if (zigT <= 0) {
        zigT += spec.zigPeriod;
        zigSign = -zigSign;
        const a = Math.atan2(p.momZ, p.momX) + zigSign * spec.zigAngle * (0.7 + Math.random() * 0.6);
        p.momX = Math.cos(a);
        p.momZ = Math.sin(a);
        // Stamp the corner itself. The kinks are the thing that reads as a
        // zigzag, so they get a mark whatever the distance cadence says.
        state.vfx?.laserMark(p.x, TRAIL_Y, p.z, p.momX, p.momZ, spec.tint, 0.52);
        markD = 0;
      }
    }

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
      // A wall bounce is the sharpest corner there is — mark it biggest.
      if (spec.markStep > 0) {
        state.vfx?.laserMark(p.x, TRAIL_Y, p.z, p.momX, p.momZ, spec.tint, 0.66);
        markD = 0;
      }
      p.bounceCombo++; // it is still a rally — the combo should feel it
    }
    // ── THE MARKS. A cross stamped every fixed step of DISTANCE (not time), so
    // the chain has the same spacing whatever the speed. With the corners above
    // this is what makes the laser read as a rapid run of crosses along a
    // zigzag rather than one long line drawn across the room.
    if (spec.markStep > 0) {
      markD += step;
      if (markD >= spec.markStep) {
        markD = 0;
        state.vfx?.laserMark(p.x, TRAIL_Y, p.z, p.momX, p.momZ, spec.tint);
      }
    }
    // ── THE TRAIL. Pushed per SUBSTEP, not per frame: at bolt speed the ball
    // crosses more than a tile per 60Hz step and can bounce inside one, so a
    // once-a-frame sample would cut every corner off the path and draw a
    // straight line through the wall it just hit.
    //
    // This is also what tells the player which way they are going. The form's
    // sprite is a camera-facing billboard — its art cannot rotate — so the
    // heading has to be carried by the path itself.
    state.vfx?.trail(p.x, TRAIL_Y, p.z, spec.tint, spec.trailLife);
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

  // A sparse afterimage of the CORE on top of the ribbon — the ribbon is the
  // path, this is the thing travelling along it. Much thinner than the old
  // every-frame ghost, which was doing the trail's job badly: a stack of
  // billboard copies reads as smear, not as a beam.
  if (p.ricochetTickT <= 0) state.vfx?.ghost(p.sprite.mesh, spec.tint, 0.18, 0.4);

  if (p.ricochetT === 0) {
    // Hand back control as a fast ride rather than a dead stop — being frozen
    // in place the instant it ends would waste the speed it built.
    p.momSpeed = RICOCHET_EXIT_SPEED;
    state.vfx?.burst(p.x, 0.5, p.z, spec.tint, 14, 4);
    state.hudDirty = true;
  }
  return true;
}
