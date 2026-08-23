//! The pinball momentum ride — port of `updatePinball` (entities/player.ts),
//! the physics half of `entities/pinball-collide.ts`, and the tuning constants
//! from `constants/pinball.ts` that they read.
//!
//! WHAT IS AND IS NOT HERE. This is the SIM: momentum, steering, reflections,
//! surface restitution, kicker/lane consumption, rail rides, the pocket-rattle
//! guard, part physics (bumper/spring/booster family/deflector/oil/spinpad/
//! sling/flipper/mirror/magstrip) and the gold/combo counters they bump.
//! Rendering side effects (vfx/sfx/shake/hitstop/anim) are absent by design —
//! they are the shell's problem. Parts that need still-unported subsystems
//! (ramp/jumppad hops, trapdoor rides, pits, targets/rollovers/lamps, hazards'
//! self-firing kinds) are deferred and TRACKED in the port checklist; the
//! `PartKind` enum grows with them so the handler match stays exhaustive.
//!
//! Marble materials (marble.ts) are not ported yet: every `material*()` hook
//! reads through `MarbleHooks::default()`, whose values are the legacy
//! no-material fallbacks. When marble.ts ports, the hooks get a real source.
//!
//! PORTS: `entities/player.ts`, `entities/pinball-collide.ts`, `shots.ts`, `constants/pinball.ts`

pub mod shots;
pub use shots::*;

use crate::collide::move_circle;
use crate::combo::{
    combo_corner_add, combo_corner_restitution, combo_friction_mul, combo_speed_ceil, combo_window,
    combo_zone, ComboZone,
};
use crate::grid::{at, is_walkable, world_to_tile, Grid, T_CRACKED};
use crate::rail::{decay_overspeed, hold_strength, step_rail, try_catch_rail};
use crate::state::{Player, SimState, PLAYER_R, PLAYER_SPEED};
use crate::surfaces::{floor_surface, wall_surface};

// ── constants/pinball.ts (the ones the sim reads) ──────────────────────────
pub const OVERCHARGE_TIME: f64 = 1.4;
pub const PINBALL_WALL_RESTITUTION: f64 = 0.94;
pub const PINBALL_CORNER_RESTITUTION: f64 = 1.08;
pub const PINBALL_CORNER_ADD: f64 = 1.0;
pub const PINBALL_MAX_SPEED: f64 = 22.0;
pub const PINBALL_FRICTION: f64 = 0.9;
pub const FRICTION_OPEN: f64 = 0.35;
pub const FRICTION_CORRIDOR: f64 = 1.0;
pub const FRICTION_TIGHT: f64 = 2.1;
pub const PINBALL_STEER: f64 = 3.6;
pub const LANE_CENTER_PULL: f64 = 5.0;
pub const LANE_PROBE_MAX: f64 = 1.8;
pub const PINBALL_EXIT_MULT: f64 = 1.05;
pub const POCKET_RADIUS: f64 = 1.4;
pub const POCKET_BOUNCES: i32 = 5;
pub const POCKET_DAMP: f64 = 0.62;
pub const POCKET_WINDOW: f64 = 1.1;
pub const BALL_SPEED_MULT: f64 = 1.35;
pub const COMBO_CEIL_BASE: f64 = 8.0;
pub const COMBO_CEIL_K: f64 = 0.15;
pub const COMBO_CEIL_NSAT: f64 = 80.0;
pub const COMBO_REST_LAMBDA: f64 = 0.08;
pub const COMBO_ADD_MU: f64 = 0.06;
pub const COMBO_WINDOW_MAX: f64 = 2.2;
pub const COMBO_WINDOW_MIN: f64 = 0.9;
pub const COMBO_WINDOW_ALPHA: f64 = 0.07;
pub const COMBO_FRICTION_K: f64 = 0.015;
pub const COMBO_ZONE_CRUISE: f64 = 8.0;
pub const COMBO_ZONE_FRENZY: f64 = 30.0;
pub const FRENZY_BALL_SPEED_MULT: f64 = 1.6;
pub const SPRINGLEGS_RESTITUTION: f64 = 1.06; // constants/skills.ts
pub const OIL_STEER_FACTOR: f64 = 0.18;
pub const TURBO_STEER_MULT: f64 = 1.35; // constants/skills.ts TURBO_STEER
pub const PART_TOUCH_BROAD_SQ: f64 = 12.0 * 12.0;
pub const BUMPER_RADIUS: f64 = 0.46;
pub const BUMPER_KICK_MULT: f64 = 1.0;
pub const BUMPER_KICK_ADD: f64 = 3.2;
pub const BUMPER_MIN_EXIT: f64 = 9.0;
pub const BUMPER_COOLDOWN: f64 = 0.25;
pub const BUMPER_SCATTER: f64 = 0.1;
pub const BUMPER_LIT_HITS: i32 = 3;
pub const BUMPER_KICK_LIT: f64 = 5.6;
pub const BUMPER_LIT_GOLD: i64 = 3;
pub const JACKPOT_BUMPERS: i32 = 5;
pub const JACKPOT_GOLD: i64 = 45;
pub const SPRING_SPEED: f64 = 16.0;
pub const SPRING_COOLDOWN: f64 = 0.6;
pub const BOOSTER_SPEED: f64 = 15.0;
pub const BOOSTER_RADIUS: f64 = 0.5;
pub const BOOSTER_COOLDOWN: f64 = 0.18;
pub const BOOSTER_STEER_LOCK: f64 = 0.16;
pub const BOOSTER_JAM_HITS: i32 = 1;
pub const BOOSTER_JAM_RADIUS: f64 = 0.9;
pub const BOOSTER_JAM_WINDOW: f64 = 0.75;
pub const BOOSTER_JAM_COOLDOWN: f64 = 0.9;
pub const CORNER_BOOST_RADIUS: f64 = 0.62;
pub const CORNER_BOOST_SPEED: f64 = 16.0;
pub const CORNER_BOOST_COOLDOWN: f64 = 0.22;
pub const CORNER_BOOST_STEER_LOCK: f64 = 0.2;
pub const CORNER_BOOST_MIN_ENTRY: f64 = 3.0;
pub const CURVE_BOOST_RADIUS: f64 = 0.55;
pub const CURVE_BOOST_SPEED: f64 = 15.5;
pub const CURVE_BOOST_COOLDOWN: f64 = 0.2;
pub const CURVE_BOOST_STEER_LOCK: f64 = 0.18;
pub const DEFLECTOR_GRAB_TIME: f64 = 0.13;
pub const DEFLECTOR_THROW_SPEED: f64 = 19.0;
pub const DEFLECTOR_THROW_BOOST: f64 = 1.18;
pub const DEFLECTOR_COOLDOWN: f64 = 0.3;
pub const OIL_RADIUS: f64 = 0.72;
pub const OIL_LAUNCH_SPEED: f64 = 7.5;
pub const OIL_LAUNCH_MULT: f64 = 1.35;
pub const OIL_SLICK_TIME: f64 = 0.55;
pub const OIL_COOLDOWN: f64 = 0.4;
pub const SPINPAD_SPEED: f64 = 11.0;
pub const SPINPAD_COOLDOWN: f64 = 0.8;
pub const SPINPAD_SPIN_RATE: f64 = 3.4;
pub const SLING_SPEED_MULT: f64 = 1.4;
pub const SLING_ADD: f64 = 2.2;
pub const SLING_MIN_EXIT: f64 = 10.0;
pub const SLING_COOLDOWN: f64 = 0.5;
pub const FLIPPER_SPEED: f64 = 18.0;
pub const FLIPPER_COOLDOWN: f64 = 0.7;
pub const FLIPPER_RADIUS: f64 = 0.6;
pub const MIRROR_RADIUS: f64 = 0.5;
pub const MIRROR_COOLDOWN: f64 = 0.18;
pub const MIRROR_BOOST: f64 = 1.02;
pub const MAGSTRIP_RADIUS: f64 = 0.55;
pub const MAGSTRIP_SPEED_CAP: f64 = 3.2;
pub const FRENZY_PART_HITS: i32 = 5;
pub const FRENZY_GOLD: i64 = 20;
pub const ARC_BANK_RADIUS: f64 = 0.62;
pub const ARC_BOOST: f64 = 1.03;
pub const ARC_COOLDOWN: f64 = 0.25;
pub const ARC_MIN_SPEED: f64 = 6.0;
pub const ARC_KICK_MULT: f64 = 1.0;
pub const ARC_KICK_ADD: f64 = 2.6;
pub const ARC_KICK_MIN_EXIT: f64 = 9.0;
pub const ARC_KICK_MIN_SPEED: f64 = 3.5;
pub const ARC_KICK_SCATTER: f64 = 0.1;
pub const ARC_KICK_COOLDOWN: f64 = 0.3;
pub const ARC_KICK_GOLD: i64 = 1;
pub const ARC_LANE_MULT: f64 = 1.12;
pub const ARC_LANE_ADD: f64 = 3.4;
pub const ARC_LANE_MIN_EXIT: f64 = 10.0;
pub const ARC_LANE_MIN_SPEED: f64 = 3.0;
pub const ARC_LANE_COOLDOWN: f64 = 0.45;
pub const ARC_LANE_GOLD: i64 = 2;
pub const RAIL_ACCEL: f64 = 15.0;
pub const RAIL_MIN_SPEED: f64 = 5.0;
pub const RAIL_HOLD_DOT: f64 = 0.35;
pub const RAIL_GRACE: f64 = 0.16;
pub const RAIL_OVERSPEED: f64 = 1.6;
pub const RAIL_DECAY: f64 = 9.0;
// constants/maze.ts — cracked/ordinary masonry break gates (the walking
// defaults; STEEL_* overrides land with the marble port).
pub const SECRET_BREAK_SPEED: f64 = 7.0;
pub const WALL_BREAK_SPEED: f64 = 15.0;
pub const WALL_BREAK_SPEED_COST: f64 = 0.7;

/// The turntable's phase — physics and renderer must read the SAME number.
pub fn spin_pad_phase(elapsed: f64, i: i32) -> f64 {
    elapsed * SPINPAD_SPIN_RATE + f64::from(i)
}

// ── Parts ──────────────────────────────────────────────────────────────────

/// The part kinds the sim can currently honour. Grows as subsystems port —
/// the exhaustive `match` in `touch_pinball_parts` is the compile guard the
/// legacy `Record<PinballPartKind, …>` table provides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartKind {
    Bumper,
    Spring,
    Booster,
    BoostCorner,
    BoostCurve,
    Deflector,
    Oil,
    SpinPad,
    Slingshot,
    Flipper,
    Mirror,
    MagStrip,
}

#[derive(Debug, Clone)]
pub struct PinballPart {
    pub kind: PartKind,
    pub i: i32,
    pub x: f64,
    pub z: f64,
    pub dir_x: f64,
    pub dir_z: f64,
    pub dir2_x: f64,
    pub dir2_z: f64,
    pub cooldown_t: f64,
    pub hit_t: f64,
    pub hits: i32,
    pub jam_n: i32,
    pub jam_x: f64,
    pub jam_z: f64,
    pub jam_t: f64,
}

impl PinballPart {
    pub fn new(kind: PartKind, i: i32, x: f64, z: f64, dir_x: f64, dir_z: f64) -> Self {
        Self {
            kind,
            i,
            x,
            z,
            dir_x,
            dir_z,
            dir2_x: 0.0,
            dir2_z: 0.0,
            cooldown_t: 0.0,
            hit_t: -1.0,
            hits: 0,
            jam_n: 0,
            jam_x: 0.0,
            jam_z: 0.0,
            jam_t: 0.0,
        }
    }
}

/// Bookkeeping every PART trigger shares — `onPartTrigger` minus the web
/// cleanse (webs land with enemies) and the toast.
fn on_part_trigger(s: &mut SimState) {
    let p = &mut s.player;
    p.bounce_combo += 1.0;
    p.bounce_combo_t = combo_window(p.bounce_combo);
    s.part_combo_hits += 1;
    if !s.frenzy_paid && s.part_combo_hits >= FRENZY_PART_HITS {
        s.frenzy_paid = true;
        s.gold_run += FRENZY_GOLD;
    }
}

/// JACKPOT — minus the zombie burst (no zombies yet) and the flash.
fn fire_jackpot(s: &mut SimState) {
    s.gold_run += JACKPOT_GOLD;
    for part in &mut s.parts {
        if part.kind == PartKind::Bumper {
            part.hits = 0;
        }
    }
    s.bumpers_lit = 0;
    s.jackpots += 1;
}

/// Sweep every ready part against the player — `touchPinballParts`, physics
/// kinds only. `in_momentum` is true from the ride, false from walking.
pub fn touch_pinball_parts(s: &mut SimState, in_momentum: bool, cur_speed: f64, steer: (f64, f64)) {
    if s.parts.is_empty() {
        return;
    }
    for idx in 0..s.parts.len() {
        if s.parts[idx].cooldown_t > 0.0 {
            continue;
        }
        let (px, pz) = (s.player.x, s.player.z);
        let dx = px - s.parts[idx].x;
        let dz = pz - s.parts[idx].z;
        let d2 = dx * dx + dz * dz;
        // BROAD PHASE — must never change WHICH parts fire, only skip the far.
        if d2 > PART_TOUCH_BROAD_SQ {
            continue;
        }
        match s.parts[idx].kind {
            PartKind::Bumper => {
                let r = BUMPER_RADIUS + PLAYER_R * 0.5;
                if d2 > r * r {
                    continue;
                }
                // `Math.sqrt(d2) || 1` — dead-centre contact degrades to 1.
                let scatter = (s.rng.next_f64() * 2.0 - 1.0)
                    * BUMPER_SCATTER
                    * s.player.marble.bumper_scatter_mult();
                let cs = libm::cos(scatter);
                let sn = libm::sin(scatter);
                let d = if d2 == 0.0 { 1.0 } else { d2.sqrt() };
                let nx = dx / d;
                let nz = dz / d;
                s.player.mom_x = nx * cs - nz * sn;
                s.player.mom_z = nx * sn + nz * cs;
                s.parts[idx].hits += 1;
                let lit = s.parts[idx].hits >= BUMPER_LIT_HITS;
                let now_lit = s.parts[idx].hits == BUMPER_LIT_HITS;
                let bumper_mult = BUMPER_KICK_MULT * s.player.marble.bumper_kick_mult();
                s.player.mom_speed = s.player.marble.max_speed().min(
                    (s.player.mom_speed * bumper_mult
                        + if lit {
                            BUMPER_KICK_LIT
                        } else {
                            BUMPER_KICK_ADD
                        })
                    .max(BUMPER_MIN_EXIT),
                );
                on_part_trigger(s);
                s.parts[idx].cooldown_t = BUMPER_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
                if lit {
                    s.gold_run += BUMPER_LIT_GOLD;
                }
                if now_lit {
                    s.bumpers_lit += 1;
                    let need = if s.bumper_total > 0 {
                        s.bumper_total.min(JACKPOT_BUMPERS)
                    } else {
                        JACKPOT_BUMPERS
                    };
                    if s.bumpers_lit >= need {
                        fire_jackpot(s);
                    }
                }
            }
            PartKind::Spring => {
                if d2 > 0.42 * 0.42 {
                    continue;
                }
                s.player.mom_x = s.parts[idx].dir_x;
                s.player.mom_z = s.parts[idx].dir_z;
                s.player.mom_speed = PINBALL_MAX_SPEED.min(s.player.mom_speed.max(SPRING_SPEED));
                on_part_trigger(s);
                s.parts[idx].cooldown_t = SPRING_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::Booster => {
                if d2 > BOOSTER_RADIUS * BOOSTER_RADIUS {
                    continue;
                }
                // JAM GUARD — keyed to a POSITION so a legit chain never trips.
                let jammed = s.parts[idx].jam_t > 0.0
                    && crate::jsmath::js_hypot(px - s.parts[idx].jam_x, pz - s.parts[idx].jam_z)
                        < BOOSTER_JAM_RADIUS;
                s.parts[idx].jam_n = if jammed { s.parts[idx].jam_n + 1 } else { 1 };
                s.parts[idx].jam_x = px;
                s.parts[idx].jam_z = pz;
                s.parts[idx].jam_t = BOOSTER_JAM_WINDOW;
                if s.parts[idx].jam_n > BOOSTER_JAM_HITS {
                    s.parts[idx].jam_n = 0;
                    s.parts[idx].cooldown_t = BOOSTER_JAM_COOLDOWN;
                    s.parts[idx].hit_t = 0.0;
                    continue;
                }
                s.player.mom_x = s.parts[idx].dir_x;
                s.player.mom_z = s.parts[idx].dir_z;
                s.player.mom_speed = PINBALL_MAX_SPEED.min(s.player.mom_speed.max(BOOSTER_SPEED));
                s.player.steer_lock_t = s.player.steer_lock_t.max(BOOSTER_STEER_LOCK);
                on_part_trigger(s);
                s.parts[idx].cooldown_t = BOOSTER_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::BoostCorner => {
                if d2 > CORNER_BOOST_RADIUS * CORNER_BOOST_RADIUS {
                    continue;
                }
                // A ball travelling roughly along the exit leg is a REBOUND.
                let along =
                    s.player.mom_x * s.parts[idx].dir2_x + s.player.mom_z * s.parts[idx].dir2_z;
                let speed = s.player.mom_speed;
                if speed > 0.5 && along > 0.7 {
                    continue;
                }
                s.player.mom_x = s.parts[idx].dir2_x;
                s.player.mom_z = s.parts[idx].dir2_z;
                s.player.mom_speed = if speed >= CORNER_BOOST_MIN_ENTRY {
                    PINBALL_MAX_SPEED.min(speed.max(CORNER_BOOST_SPEED))
                } else {
                    PINBALL_MAX_SPEED.min(speed.max(CORNER_BOOST_MIN_ENTRY))
                };
                s.player.steer_lock_t = s.player.steer_lock_t.max(CORNER_BOOST_STEER_LOCK);
                on_part_trigger(s);
                s.parts[idx].cooldown_t = CORNER_BOOST_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::BoostCurve => {
                if d2 > CURVE_BOOST_RADIUS * CURVE_BOOST_RADIUS {
                    continue;
                }
                let len = crate::jsmath::js_hypot(s.parts[idx].dir_x, s.parts[idx].dir_z);
                let len = if len == 0.0 { 1.0 } else { len };
                s.player.mom_x = s.parts[idx].dir_x / len;
                s.player.mom_z = s.parts[idx].dir_z / len;
                s.player.mom_speed =
                    PINBALL_MAX_SPEED.min(s.player.mom_speed.max(CURVE_BOOST_SPEED));
                s.player.steer_lock_t = s.player.steer_lock_t.max(CURVE_BOOST_STEER_LOCK);
                on_part_trigger(s);
                s.parts[idx].cooldown_t = CURVE_BOOST_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::Deflector => {
                if !in_momentum || s.player.grab_t > 0.0 || d2 > 0.5 * 0.5 {
                    continue;
                }
                let in_from_1 =
                    s.player.mom_x * -s.parts[idx].dir_x + s.player.mom_z * -s.parts[idx].dir_z;
                let in_from_2 =
                    s.player.mom_x * -s.parts[idx].dir2_x + s.player.mom_z * -s.parts[idx].dir2_z;
                if in_from_1 < 0.3 && in_from_2 < 0.3 {
                    continue;
                }
                if in_from_1 >= in_from_2 {
                    s.player.throw_dir_x = s.parts[idx].dir2_x;
                    s.player.throw_dir_z = s.parts[idx].dir2_z;
                } else {
                    s.player.throw_dir_x = s.parts[idx].dir_x;
                    s.player.throw_dir_z = s.parts[idx].dir_z;
                }
                s.player.grab_t = DEFLECTOR_GRAB_TIME;
                s.player.grab_x = s.parts[idx].x;
                s.player.grab_z = s.parts[idx].z;
                s.player.throw_speed = PINBALL_MAX_SPEED
                    .min((s.player.mom_speed * DEFLECTOR_THROW_BOOST).max(DEFLECTOR_THROW_SPEED));
                on_part_trigger(s);
                s.parts[idx].cooldown_t = DEFLECTOR_COOLDOWN + DEFLECTOR_GRAB_TIME;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::Oil => {
                if d2 > OIL_RADIUS * OIL_RADIUS {
                    continue;
                }
                if in_momentum {
                    s.player.oil_t = OIL_SLICK_TIME; // a zone, not a trigger
                    continue;
                }
                if cur_speed < 0.5 {
                    continue;
                }
                let (ax, az) = steer;
                if ax == 0.0 && az == 0.0 {
                    continue;
                }
                let wl = crate::jsmath::js_hypot(ax, az);
                let wl = if wl == 0.0 { 1.0 } else { wl };
                s.player.mom_x = ax / wl;
                s.player.mom_z = az / wl;
                s.player.mom_speed =
                    PINBALL_MAX_SPEED.min((cur_speed * OIL_LAUNCH_MULT).max(OIL_LAUNCH_SPEED));
                s.player.oil_t = OIL_SLICK_TIME;
                s.parts[idx].cooldown_t = OIL_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::SpinPad => {
                if d2 > 0.45 * 0.45 {
                    continue;
                }
                let in_len = crate::jsmath::js_hypot(s.player.mom_x, s.player.mom_z);
                let ix = if in_len > 0.01 {
                    s.player.mom_x / in_len
                } else {
                    s.parts[idx].dir_x
                };
                let iz = if in_len > 0.01 {
                    s.player.mom_z / in_len
                } else {
                    s.parts[idx].dir_z
                };
                let turn = spin_pad_phase(s.elapsed, s.parts[idx].i);
                let cs = libm::cos(turn);
                let sn = libm::sin(turn);
                s.player.mom_x = ix * cs - iz * sn;
                s.player.mom_z = ix * sn + iz * cs;
                s.player.mom_speed = PINBALL_MAX_SPEED.min(s.player.mom_speed.max(SPINPAD_SPEED));
                on_part_trigger(s);
                s.parts[idx].cooldown_t = SPINPAD_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::Slingshot => {
                if d2 > 0.5 * 0.5 {
                    continue;
                }
                if in_momentum {
                    let along = if s.player.mom_x * s.parts[idx].dir_x
                        + s.player.mom_z * s.parts[idx].dir_z
                        >= 0.0
                    {
                        1.0
                    } else {
                        -1.0
                    };
                    s.player.mom_x = s.parts[idx].dir_x * along;
                    s.player.mom_z = s.parts[idx].dir_z * along;
                    s.player.mom_speed = PINBALL_MAX_SPEED.min(
                        (s.player.mom_speed * SLING_SPEED_MULT + SLING_ADD).max(SLING_MIN_EXIT),
                    );
                } else {
                    s.player.mom_x = s.parts[idx].dir_x;
                    s.player.mom_z = s.parts[idx].dir_z;
                    s.player.mom_speed = SLING_MIN_EXIT;
                }
                on_part_trigger(s);
                s.parts[idx].cooldown_t = SLING_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::Flipper => {
                if d2 > FLIPPER_RADIUS * FLIPPER_RADIUS {
                    continue;
                }
                let mut ex = s.parts[idx].dir_x;
                let mut ez = s.parts[idx].dir_z;
                if in_momentum && s.player.mom_speed > 0.5 {
                    let bx = s.parts[idx].dir_x * 0.72 + s.player.mom_x * 0.38;
                    let bz = s.parts[idx].dir_z * 0.72 + s.player.mom_z * 0.38;
                    let bl = crate::jsmath::js_hypot(bx, bz);
                    let bl = if bl == 0.0 { 1.0 } else { bl };
                    ex = bx / bl;
                    ez = bz / bl;
                }
                s.player.mom_x = ex;
                s.player.mom_z = ez;
                s.player.mom_speed = PINBALL_MAX_SPEED.min(s.player.mom_speed.max(FLIPPER_SPEED));
                on_part_trigger(s);
                s.parts[idx].cooldown_t = FLIPPER_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::Mirror => {
                if !in_momentum || d2 > MIRROR_RADIUS * MIRROR_RADIUS {
                    continue;
                }
                let nl = crate::jsmath::js_hypot(s.parts[idx].dir_x, s.parts[idx].dir_z);
                let nl = if nl == 0.0 { 1.0 } else { nl };
                let nx = -s.parts[idx].dir_z / nl;
                let nz = s.parts[idx].dir_x / nl;
                let dot = s.player.mom_x * nx + s.player.mom_z * nz;
                if dot.abs() < 0.2 {
                    continue;
                }
                s.player.mom_x -= 2.0 * dot * nx;
                s.player.mom_z -= 2.0 * dot * nz;
                s.player.mom_speed = PINBALL_MAX_SPEED.min(s.player.mom_speed * MIRROR_BOOST);
                on_part_trigger(s);
                s.parts[idx].cooldown_t = MIRROR_COOLDOWN;
                s.parts[idx].hit_t = 0.0;
            }
            PartKind::MagStrip => {
                if d2 > MAGSTRIP_RADIUS * MAGSTRIP_RADIUS {
                    continue;
                }
                // (Magnet Boots + water steam land with their subsystems.)
                if s.player.mom_speed > MAGSTRIP_SPEED_CAP {
                    s.player.mom_speed = MAGSTRIP_SPEED_CAP;
                }
                // The 30%-chance spark draw is render-only, but it CONSUMES a
                // random number in the legacy engine. The sim must not draw
                // one here or every later rng call is off by a draw — the
                // fixture loop skips it too (vfx is behind `state.vfx?`,
                // absent headless... except Math.random() evaluates BEFORE
                // the optional call. Mirrored in the fixture loop: one draw).
                let _ = s.rng.next_f64();
            }
        }
    }
}

// ── The ride ───────────────────────────────────────────────────────────────

/// `wallClearance` — how far to a wall along (dir), capped at LANE_PROBE_MAX.
fn wall_clearance(g: &Grid, x: f64, z: f64, dir_x: f64, dir_z: f64) -> f64 {
    let mut d = PLAYER_R;
    while d <= LANE_PROBE_MAX {
        let (i, j) = world_to_tile(g, x + dir_x * d, z + dir_z * d);
        if !is_walkable(g, i, j) {
            return d;
        }
        d += 0.12;
    }
    LANE_PROBE_MAX
}

/// `applySurfaceCombo` — advance the chain by what the struck surface is worth.
fn apply_surface_combo(p: &mut Player, combo_ticks: f64, breaks_combo: bool) {
    if breaks_combo {
        p.bounce_combo = 0.0;
        p.bounce_combo_t = 0.0;
        return;
    }
    p.bounce_combo += combo_ticks;
    p.bounce_combo_t = combo_window(p.bounce_combo);
}

/// `notePocketBounce` — the pocket-rattle guard.
fn note_pocket_bounce(s: &mut SimState) {
    let p = &mut s.player;
    if s.pocket_t > 0.0
        && crate::jsmath::js_hypot(p.x - s.pocket_ax, p.z - s.pocket_az) < POCKET_RADIUS
    {
        s.pocket_n += 1;
        if s.pocket_n > POCKET_BOUNCES {
            p.mom_speed *= POCKET_DAMP;
        }
    } else {
        s.pocket_ax = p.x;
        s.pocket_az = p.z;
        s.pocket_n = 1;
    }
    s.pocket_t = POCKET_WINDOW;
}

/// `trySmashAhead` / `crackedAhead` probe — is the tile that stopped us cracked?
/// (Smashing consumes maze state the port doesn't have yet — secrets land with
/// P2. Today the probe exists so the reflection path is order-identical; on a
/// floor with no T_CRACKED it never fires, which the demo floor guarantees.)
fn cracked_ahead(
    g: &Grid,
    x: f64,
    z: f64,
    dir_x: f64,
    dir_z: f64,
    blocked_x: bool,
    blocked_z: bool,
) -> bool {
    if blocked_x {
        let (i, j) = world_to_tile(g, x + dir_x.signum() * (PLAYER_R + 0.12), z);
        if at(g, i, j) == T_CRACKED {
            return true;
        }
    }
    if blocked_z {
        let (i, j) = world_to_tile(g, x, z + dir_z.signum() * (PLAYER_R + 0.12));
        if at(g, i, j) == T_CRACKED {
            return true;
        }
    }
    false
}

/// `bankArcCorners` — sweep momentum leg→leg through auto-banked maze corners.
fn bank_arc_corners(s: &mut SimState, dt: f64) {
    for idx in 0..s.arc_corners.len() {
        if s.arc_corners[idx].cooldown_t > 0.0 {
            s.arc_corners[idx].cooldown_t = (s.arc_corners[idx].cooldown_t - dt).max(0.0);
            continue;
        }
        if s.player.mom_speed < ARC_MIN_SPEED {
            continue;
        }
        let dx = s.player.x - s.arc_corners[idx].cx;
        let dz = s.player.z - s.arc_corners[idx].cz;
        if dx * dx + dz * dz > ARC_BANK_RADIUS * ARC_BANK_RADIUS {
            continue;
        }
        let arc = &s.arc_corners[idx];
        let in_from_1 = s.player.mom_x * -arc.d1x + s.player.mom_z * -arc.d1z;
        let in_from_2 = s.player.mom_x * -arc.d2x + s.player.mom_z * -arc.d2z;
        if in_from_1 < 0.3 && in_from_2 < 0.3 {
            continue;
        }
        if in_from_1 >= in_from_2 {
            s.player.mom_x = arc.d2x;
            s.player.mom_z = arc.d2z;
        } else {
            s.player.mom_x = arc.d1x;
            s.player.mom_z = arc.d1z;
        }
        s.player.mom_speed = PINBALL_MAX_SPEED.min(s.player.mom_speed * ARC_BOOST);
        s.arc_corners[idx].cooldown_t = ARC_COOLDOWN;
        s.arc_corners[idx].hit_t = 0.0;
        on_part_trigger(s);
        break; // one bank per frame
    }
}

/// One frame of the momentum ride — `updatePinball`, sim half. Returns true
/// while the ride owns the player. `steer` is the world-space input direction
/// (the shell already converted screen→world; zero when idle).
pub fn update_pinball(s: &mut SimState, dt: f64, steer_in: (f64, f64)) -> bool {
    if s.player.mom_speed <= 0.0 {
        return false;
    }

    // DEFLECTOR GRAB-THROW hold: pinned, untouchable, then hurled.
    if s.player.grab_t > 0.0 {
        s.player.grab_t -= dt;
        s.player.x = s.player.grab_x;
        s.player.z = s.player.grab_z;
        s.player.iframes = s.player.iframes.max(0.2);
        if s.player.grab_t <= 0.0 {
            s.player.grab_t = 0.0;
            s.player.mom_x = s.player.throw_dir_x;
            s.player.mom_z = s.player.throw_dir_z;
            s.player.mom_speed = s.player.throw_speed;
        }
        return true;
    }

    // TEMPO ZONES — the upward crossing arms ball form at Cruise.
    let zone = combo_zone(s.player.bounce_combo);
    if zone != s.combo_zone {
        if zone > s.combo_zone && zone == ComboZone::Cruise {
            s.player.overcharge = 1.0;
        }
        s.combo_zone = zone;
    }

    let is_ball = s.player.overcharge >= 1.0;
    let speed_mul = if is_ball {
        if zone == ComboZone::Frenzy {
            FRENZY_BALL_SPEED_MULT
        } else {
            BALL_SPEED_MULT
        }
    } else {
        1.0
    };

    // Overcharge keeps building WHILE bouncing.
    s.player.overcharge = 1.0_f64.min(s.player.overcharge + dt / OVERCHARGE_TIME);

    // Steer: bend the momentum (a nudge, not full control).
    s.player.steer_lock_t = (s.player.steer_lock_t - dt).max(0.0);
    let (sti, stj) = world_to_tile(&s.grid, s.player.x, s.player.z);
    let steer_surf = floor_surface(crate::grid::surface_at(&s.grid, sti, stj));
    let steer_mul = (if s.player.oil_t > 0.0 {
        OIL_STEER_FACTOR
    } else if s.player.turbo_t > 0.0 {
        TURBO_STEER_MULT
    } else {
        1.0
    }) * steer_surf.steer_mult
        * s.player.marble.steer_mult();
    let (mut steer_x, mut steer_z) = (0.0, 0.0);
    {
        let (ax, az) = steer_in;
        if ax != 0.0 || az != 0.0 {
            let wl = crate::jsmath::js_hypot(ax, az);
            let wl = if wl == 0.0 { 1.0 } else { wl };
            steer_x = ax / wl;
            steer_z = az / wl;
        }
    }
    if s.player.steer_lock_t <= 0.0 && (steer_x != 0.0 || steer_z != 0.0) {
        s.player.mom_x += steer_x * PINBALL_STEER * steer_mul * dt;
        s.player.mom_z += steer_z * PINBALL_STEER * steer_mul * dt;
        let ml = crate::jsmath::js_hypot(s.player.mom_x, s.player.mom_z);
        let ml = if ml == 0.0 { 1.0 } else { ml };
        s.player.mom_x /= ml;
        s.player.mom_z /= ml;
    }

    // Advance and detect a wall hit. (phaseMove == move_circle until shadow.)
    let step = s.player.mom_speed * speed_mul * dt;
    let want_x = s.player.x + s.player.mom_x * step;
    let want_z = s.player.z + s.player.mom_z * step;
    let player_r = s.player.marble.player_radius(PLAYER_R);
    let res = move_circle(
        &s.grid,
        s.player.x,
        s.player.z,
        player_r,
        s.player.mom_x * step,
        s.player.mom_z * step,
    );
    let blocked_x = (res.x - want_x).abs() > 1e-3;
    let blocked_z = (res.z - want_z).abs() > 1e-3;
    s.player.x = res.x;
    s.player.z = res.z;

    // LANE GLIDE — centre the ball in the corridor cross-section.
    if s.player.steer_lock_t <= 0.0 && s.player.mom_speed > PLAYER_SPEED {
        let along_x = s.player.mom_x.abs() >= s.player.mom_z.abs();
        let (perp_x, perp_z) = if along_x { (0.0, 1.0) } else { (1.0, 0.0) };
        let cp = wall_clearance(&s.grid, s.player.x, s.player.z, perp_x, perp_z);
        let cn = wall_clearance(&s.grid, s.player.x, s.player.z, -perp_x, -perp_z);
        let near_wall = cp < LANE_PROBE_MAX || cn < LANE_PROBE_MAX;
        let imbalance = cp - cn;
        if near_wall && imbalance.abs() > 0.12 {
            let steering = steer_x != 0.0 || steer_z != 0.0;
            let strength = if steering { 0.45 } else { 1.0 };
            let dir = imbalance.signum();
            let pull_rate = LANE_CENTER_PULL * s.player.marble.lane_pull_mult();
            let nudge = (imbalance.abs() * 0.5).min(pull_rate * dt) * strength;
            let r2 = move_circle(
                &s.grid,
                s.player.x,
                s.player.z,
                player_r,
                perp_x * dir * nudge,
                perp_z * dir * nudge,
            );
            s.player.x = r2.x;
            s.player.z = r2.z;
        }
    }

    s.pocket_t = (s.pocket_t - dt).max(0.0);

    // RAIL contact for THIS frame, filled by the collision block below.
    let mut rail_contact = false;
    let mut rail_strength = 0.0;
    let mut rail_tangent: Option<(f64, f64)> = None;

    if let Some((nx, nz)) = res.hit_n {
        let vn = s.player.mom_x * nx + s.player.mom_z * nz;
        // BANKED RAIL — checked before the one-shot lane; supersedes it.
        if let Some(lane) = &res.hit_lane {
            if lane.concave {
                let strength = hold_strength(steer_x, steer_z, nx, nz);
                if s.player.rail.feature_idx != lane.feature_idx {
                    s.player.rail.feature_idx = -1;
                    try_catch_rail(
                        &mut s.player.rail,
                        lane.feature_idx,
                        strength,
                        s.player.mom_speed,
                    );
                }
                rail_contact = true;
                rail_strength = strength;
                rail_tangent = Some((lane.tx, lane.tz));
            }
        }
        let lane_fires = res.hit_lane.is_some()
            && s.player.mom_speed >= ARC_LANE_MIN_SPEED
            && s.player.rail.feature_idx < 0;
        if lane_fires {
            let lane = res.hit_lane.as_ref().unwrap();
            let (ltx, ltz, lfi, lband) = (lane.tx, lane.tz, lane.feature_idx, lane.band);
            s.player.mom_speed = PINBALL_MAX_SPEED
                .min((s.player.mom_speed * ARC_LANE_MULT + ARC_LANE_ADD).max(ARC_LANE_MIN_EXIT));
            s.player.mom_x = ltx * s.player.mom_speed;
            s.player.mom_z = ltz * s.player.mom_speed;
            let f = &mut s.grid.arcs[lfi as usize].lanes[lband];
            f.cooldown_t = ARC_LANE_COOLDOWN;
            f.hit_t = 0.0;
            on_part_trigger(s);
            note_pocket_bounce(s);
            s.gold_run += ARC_LANE_GOLD;
        } else if vn < 0.0 {
            s.player.mom_x -= 2.0 * vn * nx;
            s.player.mom_z -= 2.0 * vn * nz;
            // BOOSTER RUBBER — the kicker band throws it, on top of the bounce.
            let kick_fires = res.hit_kick.is_some() && s.player.mom_speed >= ARC_KICK_MIN_SPEED;
            if kick_fires {
                let scatter = (s.rng.next_f64() * 2.0 - 1.0) * ARC_KICK_SCATTER;
                let cs = libm::cos(scatter);
                let sn = libm::sin(scatter);
                let mx = s.player.mom_x;
                let mz = s.player.mom_z;
                s.player.mom_x = mx * cs - mz * sn;
                s.player.mom_z = mx * sn + mz * cs;
                s.player.mom_speed = PINBALL_MAX_SPEED.min(
                    (s.player.mom_speed * ARC_KICK_MULT + ARC_KICK_ADD).max(ARC_KICK_MIN_EXIT),
                );
                let k = res.hit_kick.as_ref().unwrap();
                let (kfi, kband) = (k.feature, k.band);
                let band = &mut s.grid.arcs[kfi].kicks[kband];
                band.cooldown_t = ARC_KICK_COOLDOWN;
                band.hit_t = 0.0;
                on_part_trigger(s);
                note_pocket_bounce(s);
                s.gold_run += ARC_KICK_GOLD;
            } else {
                // SURFACE — what this slant is made of scales the reflection.
                let surf = wall_surface(res.hit_surface);
                let base_rest = s.player.marble.flat_restitution().unwrap_or_else(|| {
                    if s.player.spring_t > 0.0 {
                        SPRINGLEGS_RESTITUTION
                    } else {
                        PINBALL_WALL_RESTITUTION
                    }
                });
                let rest = base_rest * surf.flat_rest_mult;
                let max_speed = s.player.marble.max_speed();
                s.player.mom_speed =
                    max_speed.min(s.player.mom_speed * rest + surf.bounce_add);
                apply_surface_combo(
                    &mut s.player,
                    f64::from(surf.combo_ticks),
                    surf.breaks_combo,
                );
                note_pocket_bounce(s);
            }
        }
    } else if blocked_x || blocked_z {
        // SECRET / KOOL-AID smashes land with the maze port (P2) — but the
        // cracked probe keeps the branch order identical, and on a floor that
        // HAS cracks the port must fail loudly rather than silently bounce.
        debug_assert!(
            !cracked_ahead(
                &s.grid,
                s.player.x,
                s.player.z,
                s.player.mom_x,
                s.player.mom_z,
                blocked_x,
                blocked_z
            ) || s.player.mom_speed < SECRET_BREAK_SPEED,
            "cracked-wall smash reached before the maze port supplies it"
        );
        if blocked_x {
            s.player.mom_x = -s.player.mom_x;
        }
        if blocked_z {
            s.player.mom_z = -s.player.mom_z;
        }
        let corner = blocked_x && blocked_z;
        let surf = wall_surface(res.hit_surface);
        let base_rest = s.player.marble.flat_restitution().unwrap_or_else(|| {
            if s.player.spring_t > 0.0 {
                SPRINGLEGS_RESTITUTION
            } else {
                PINBALL_WALL_RESTITUTION
            }
        });
        let flat_rest = base_rest * surf.flat_rest_mult;
        let max_speed = s.player.marble.max_speed();
        if corner {
            let gain = (s.player.mom_speed * combo_corner_restitution(s.player.bounce_combo)
                + combo_corner_add(s.player.bounce_combo) * s.player.marble.corner_add_mult())
            .min(combo_speed_ceil(s.player.bounce_combo));
            let next = if surf.corner_mult >= 1.0 {
                s.player.mom_speed.max(gain * surf.corner_mult)
            } else {
                gain * surf.corner_mult
            };
            s.player.mom_speed = max_speed.min(next);
        } else {
            s.player.mom_speed =
                max_speed.min(s.player.mom_speed * flat_rest + surf.bounce_add);
        }
        apply_surface_combo(
            &mut s.player,
            f64::from(surf.combo_ticks),
            surf.breaks_combo,
        );
        note_pocket_bounce(s);
    }

    // RAIL STEP — every frame, contact or not.
    {
        let step = step_rail(
            &mut s.player.rail,
            rail_contact,
            rail_strength,
            s.player.mom_speed,
            dt,
        );
        if step.riding {
            if let Some((tx, tz)) = rail_tangent {
                s.player.mom_speed = step.speed;
                s.player.mom_x = tx;
                s.player.mom_z = tz;
                // Rail gold ticks at RAIL_GOLD_HZ — accumulator on the state.
                s.rail_gold_t += dt;
                let gold_every = 1.0 / 6.0; // RAIL_GOLD_HZ
                while s.rail_gold_t >= gold_every {
                    s.rail_gold_t -= gold_every;
                    s.gold_run += 1;
                }
            }
        } else if step.released {
            s.rail_gold_t = 0.0;
        }
    }
    if s.player.rail.feature_idx < 0 {
        s.player.mom_speed = decay_overspeed(s.player.mom_speed, dt);
    }

    // Parts, then banked maze corners. Part triggers feed the pocket guard.
    let combo_before = s.player.bounce_combo;
    touch_pinball_parts(s, true, 0.0, (steer_x, steer_z));
    if s.player.bounce_combo != combo_before {
        note_pocket_bounce(s);
    }
    bank_arc_corners(s, dt);

    // Friction: topology term × floor surface, combo-deep grip, oil/turbo zero.
    let (ti, tj) = world_to_tile(&s.grid, s.player.x, s.player.z);
    let mut open_n = 0;
    for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
        if is_walkable(&s.grid, ti + di, tj + dj) {
            open_n += 1;
        }
    }
    let floor_surf = floor_surface(crate::grid::surface_at(&s.grid, ti, tj));
    let surf_mul = (if open_n >= 3 {
        FRICTION_OPEN
    } else if open_n == 2 {
        FRICTION_CORRIDOR
    } else {
        FRICTION_TIGHT
    }) * floor_surf.friction_mult;
    let friction = if s.player.oil_t > 0.0 || s.player.turbo_t > 0.0 {
        0.0
    } else {
        PINBALL_FRICTION
            * surf_mul
            * combo_friction_mul(s.player.bounce_combo)
            * s.player.marble.friction_mult()
    };
    s.player.mom_speed = (s.player.mom_speed - friction * dt).max(0.0);
    s.player.bounce_combo_t = (s.player.bounce_combo_t - dt).max(0.0);
    if s.player.bounce_combo_t <= 0.0 {
        s.player.bounce_combo = 0.0;
        s.part_combo_hits = 0;
        s.frenzy_paid = false;
    }

    // i-frames top-up (the ram/aura/anim blocks are render+combat, not sim).
    s.player.iframes = s.player.iframes.max(if is_ball { 0.2 } else { 0.08 });

    // Exit only when the momentum has genuinely bled off.
    if s.player.mom_speed < PLAYER_SPEED * PINBALL_EXIT_MULT {
        s.player.mom_speed = 0.0;
        s.player.grab_t = 0.0;
        s.player.bounce_combo = 0.0;
        s.player.bounce_combo_t = 0.0;
        s.part_combo_hits = 0;
        s.frenzy_paid = false;
        s.player.overcharge = s.player.overcharge.min(0.999);
    }

    true
}

/// Tick the per-part timers the legacy parts renderer owns (cooldown, hit
/// flash, jam window). In the sim they tick at the top of the frame — the
/// fixture loop mirrors this order exactly.
pub fn tick_parts(s: &mut SimState, dt: f64) {
    for part in &mut s.parts {
        if part.cooldown_t > 0.0 {
            part.cooldown_t = (part.cooldown_t - dt).max(0.0);
        }
        if part.hit_t >= 0.0 {
            part.hit_t += dt;
        }
        if part.jam_t > 0.0 {
            part.jam_t = (part.jam_t - dt).max(0.0);
            if part.jam_t == 0.0 {
                part.jam_n = 0; // renderer resets the streak with the window
            }
        }
    }
    // Arc band timers (kicks + lanes) tick with the same clock.
    for arc in &mut s.grid.arcs {
        for k in &mut arc.kicks {
            if k.cooldown_t > 0.0 {
                k.cooldown_t = (k.cooldown_t - dt).max(0.0);
            }
            if k.hit_t >= 0.0 {
                k.hit_t += dt;
            }
        }
        for l in &mut arc.lanes {
            if l.cooldown_t > 0.0 {
                l.cooldown_t = (l.cooldown_t - dt).max(0.0);
            }
            if l.hit_t >= 0.0 {
                l.hit_t += dt;
            }
        }
    }
}
