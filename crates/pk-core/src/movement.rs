//! MOVEMENT POLICIES — what a monster is TRYING to do with its feet.
//!
//! PORTS: `entities/movement.ts`
//!
//! A dispatch table keyed by INTENT, not by family: one exhaustive
//! `MovementKind -> handler`, one lookup per actor per frame, and no
//! fall-through for a new kind to land in. Twenty-two enemy families and eight
//! zombie sub-types all approach the knight along the same line at different
//! speeds; the deviations from that line are what this file is.
//!
//! ## The contract, and why it is plain data
//!
//! A handler answers ONE question — "which way do I want to go this frame, and
//! how fast" — from plain numbers. It never touches the world, the grid or the
//! renderer, which is what makes every policy here unit-testable and, more
//! importantly, MEASURABLE: the oracle's `movement.test.ts` drives each handler
//! over a simulated approach and asserts the path differs from `chase` on a
//! NAMED quantity (off-axis angle, held range, curvature). **A movement type
//! that measures identical to chase is a label, not a behaviour** — that is the
//! standard the ported tests below hold to as well.
//!
//! Anything that is a STATUS rather than an intent — the oil skid, the shadow
//! lure, the bat's wobble, separation, chill — is a post-stage in `zombie.ts`
//! and layers on top of whatever the handler asked for. Intent and affliction
//! are different axes; collapsing them is how the original cascade grew.
//!
//! ## Determinism
//!
//! Zero RNG. Every per-actor asymmetry (which way a flanker peels, which way an
//! orbiter rings) comes from `move_phase`, seeded from the co-op nid at spawn,
//! so two peers watching the same horde see the same arcs.
//!
//! ⚠️ `js_hypot`, `js_cos` and `js_sin`, never `f64::hypot`/`cos`/`sin` — V8's
//! are not the correctly-rounded libm ones and this steering feeds positions
//! that fixtures compare bit-exactly (see the `jsmath` module header).

use crate::enemies::*;
use crate::jsmath::{js_cos, js_hypot, js_sin};

/// The movement vocabulary. Intents, not families — a policy is shared by every
/// family that wants to move that way, which is why a new enemy costs a table
/// row instead of a branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MovementKind {
    /// Downhill on the flow field, straight at the knight up close. The default.
    Chase,
    /// Ranged: back off when crowded, hold the firing band, path in when far.
    Kite,
    /// Furniture with teeth — faces you, never takes a step, never gets shoved.
    Rooted,
    /// Ignores the maze entirely and drifts through walls (ghost, Death Dealer).
    Phase,
    /// No AI at all; something else integrates its motion (the bowling pin).
    Inert,
    /// Approaches OFF-AXIS, closing the angle only as it arrives.
    Flanker,
    /// Holds a preferred range, circles, and darts in on a cadence.
    Strafer,
    /// Motionless until it has line of sight AND you are close, then commits.
    Ambusher,
    /// Rings you at radius, spiralling slowly inward.
    Orbiter,
    /// Telegraphed crouch, then a committed pounce along a curved arc.
    Leaper,
    /// Will not fight you alone; stalks until the pack lands, then surges.
    PackHunter,
}

/// Every kind, in the oracle's declaration order — the twin of `MOVEMENT_KINDS`.
/// Exhaustiveness is a `match` here, but the LIST is what tests iterate.
pub const MOVEMENT_KINDS: [MovementKind; 11] = [
    MovementKind::Chase,
    MovementKind::Kite,
    MovementKind::Rooted,
    MovementKind::Phase,
    MovementKind::Inert,
    MovementKind::Flanker,
    MovementKind::Strafer,
    MovementKind::Ambusher,
    MovementKind::Orbiter,
    MovementKind::Leaper,
    MovementKind::PackHunter,
];

/// Telegraph colours, one per policy that has one — the "learn the monster"
/// channel. A behaviour the player cannot see coming is indistinguishable from
/// no behaviour at all.
pub mod tell {
    /// Flanker — cold blue while it is deliberately off your line.
    pub const FLANK: u32 = 0x9fd0ff;
    /// Strafer — amber while circling, ramping hot before a dart.
    pub const STRAFE: u32 = 0xffd98a;
    /// Strafer's dart / ambusher's commit — the same hot orange as a bite windup.
    pub const COMMIT: u32 = 0xff7a2a;
    /// Orbiter — violet while it rings you.
    pub const ORBIT: u32 = 0xc9a0ff;
    /// Leaper — the crouch, ramping to full over `LEAP_WINDUP`.
    pub const LEAP: u32 = 0xff4d2a;
    /// Pack-hunter — sickly green while it waits for numbers.
    pub const PACK: u32 = 0x8fe08f;
}

/// The mutable slice of an actor a policy may see and write.
///
/// Deliberately NOT the whole monster: a handler that could reach the sprite
/// would drag the renderer into this module and take the tests with it.
#[derive(Debug, Clone, Copy, Default)]
pub struct MoveActor {
    pub x: f64,
    pub z: f64,
    /// World units per second, already carrying floor scaling + sub-type mult.
    pub speed: f64,
    /// Deterministic per-actor phase in [0,1), seeded from the co-op nid.
    /// Drives every left/right asymmetry so peers agree and neighbours do not
    /// mirror each other.
    pub move_phase: f64,
    /// Policy commit flag/timer. Meaning is per-policy; 0 = uncommitted.
    pub move_commit: f64,
    /// Policy clock (seconds). Cadences, spiral tightening, leap phases.
    pub move_t: f64,
    /// Committed heading, for the policies that lock a line (the leaper's arc).
    pub move_dir_x: f64,
    pub move_dir_z: f64,
}

/// Everything a handler needs about the world, as plain numbers.
#[derive(Debug, Clone, Copy, Default)]
pub struct MoveCtx {
    pub dt: f64,
    /// Player minus actor, and its length.
    pub pdx: f64,
    pub pdz: f64,
    pub pdist: f64,
    /// The flow field's preferred heading (unit), or (0,0) when there is no
    /// field / the actor stands on the player's own tile. The ONE pathfinding
    /// substrate — no policy here builds a second one.
    pub flow_x: f64,
    pub flow_z: f64,
    /// This actor's attack reach, so a policy can hold just outside it.
    pub contact_range: f64,
    /// Clear straight line to the player? Only computed for ambushers/leapers.
    pub los: bool,
    /// Living, awake foes within `PACK_RANGE`, self included — ANY of them, not
    /// just other pack-hunters.
    ///
    /// That distinction is the difference between a shipped mechanic and a dead
    /// one. Counting only same-policy neighbours was the oracle's first version
    /// and a headless census killed it: pack-hunters are one sub-type at 12%
    /// weight, so a real floor scatters four or five across the whole maze and
    /// three are almost never within 5.5 units of each other. A "quorum" of
    /// four spawned on a ring held at 4.99 and NEVER engaged — a behaviour that
    /// passes every unit test and never occurs in the game.
    pub pack_near: i32,
    /// True when a nearby pack-hunter has already committed — the surge spreads.
    pub pack_committed: bool,
}

/// A telegraph the caller should paint so the intent is LEARNABLE.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MoveTell {
    /// Target tint, blended from white by `k`.
    pub color: u32,
    /// 0..1 intensity.
    pub k: f64,
}

/// What a policy wants done with this actor's feet this frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Steer {
    /// Desired heading. Handlers return unit vectors and use `mult` for
    /// magnitude — the caller normalises nothing.
    pub vx: f64,
    pub vz: f64,
    /// Speed multiplier for this frame.
    pub mult: f64,
    /// Never moved by steering OR separation — it holds its tile.
    pub rooted: bool,
    /// Deliberately standing still: play the idle clip even though it is aggroed.
    pub hold: bool,
    /// Committed to a locked line: separation must not shove it off the arc.
    pub locked: bool,
    /// The readable tell for this frame, if the policy has one right now.
    pub tell: Option<MoveTell>,
}

impl Default for Steer {
    fn default() -> Self {
        Self {
            vx: 0.0,
            vz: 0.0,
            // 1.0, not 0.0 — the TS `mult?: number` is read as `mult ?? 1`, so
            // an omitted multiplier means FULL speed. Defaulting this to zero
            // would freeze every policy that does not set it.
            mult: 1.0,
            rooted: false,
            hold: false,
            locked: false,
            tell: None,
        }
    }
}

const ZERO: Steer = Steer {
    vx: 0.0,
    vz: 0.0,
    mult: 1.0,
    rooted: false,
    hold: false,
    locked: false,
    tell: None,
};

/// Unit vector toward the player, or (0,0) when standing on them.
fn to_player(c: &MoveCtx) -> (f64, f64) {
    if c.pdist <= 1e-4 {
        return (0.0, 0.0);
    }
    (c.pdx / c.pdist, c.pdz / c.pdist)
}

/// Rotate a 2-vector by `a` radians (world XZ plane).
fn rot(vx: f64, vz: f64, a: f64) -> (f64, f64) {
    let cs = js_cos(a);
    let sn = js_sin(a);
    (vx * cs - vz * sn, vx * sn + vz * cs)
}

/// Normalise, or (0,0) if degenerate.
fn unit(vx: f64, vz: f64) -> (f64, f64) {
    let d = js_hypot(vx, vz);
    if d > 1e-6 {
        (vx / d, vz / d)
    } else {
        (0.0, 0.0)
    }
}

/// −1 or +1, deterministically, from the actor's seeded phase.
fn side(a: &MoveActor) -> f64 {
    if a.move_phase < 0.5 {
        -1.0
    } else {
        1.0
    }
}

/// ⚠️ NOT `f64::clamp`, and clippy's suggestion to use it is wrong here.
/// `clamp` PANICS on a NaN bound and its NaN handling differs from this branch
/// chain, which returns `x` unchanged — exactly what the oracle's
/// `x < 0 ? 0 : x > 1 ? 1 : x` does. The shapes only agree on finite input, and
/// a panic in a movement policy is a worse failure than a NaN heading that the
/// caller's `h > 1e-6` guard already drops.
#[allow(clippy::manual_clamp)]
fn clamp01(x: f64) -> f64 {
    if x < 0.0 {
        0.0
    } else if x > 1.0 {
        1.0
    } else {
        x
    }
}

/// THE BASELINE. Downhill on the flow field until within `DIRECT_STEER_RANGE`,
/// then straight at the knight — the field only knows tile centres, and
/// door-frame shuffling at close range looks robotic.
///
/// Every other grounded policy is a deviation from this line, and the tests
/// measure the deviation.
fn chase(_a: &mut MoveActor, c: &MoveCtx) -> Steer {
    if c.pdist <= DIRECT_STEER_RANGE {
        let (ux, uz) = to_player(c);
        return Steer {
            vx: ux,
            vz: uz,
            ..Steer::default()
        };
    }
    Steer {
        vx: c.flow_x,
        vz: c.flow_z,
        ..Steer::default()
    }
}

/// KITE — the spitter/webspinner/necromancer policy: too close → back away to
/// keep firing distance; inside the fire band → hold still and shoot; too far →
/// path in like anything else.
fn kite(_a: &mut MoveActor, c: &MoveCtx) -> Steer {
    if c.pdist < SPITTER_KITE_RANGE && c.pdist > 1e-4 {
        let (ux, uz) = to_player(c);
        return Steer {
            vx: -ux,
            vz: -uz,
            ..Steer::default()
        };
    }
    if c.pdist <= c.contact_range {
        return ZERO; // in range, not too close: shoot
    }
    Steer {
        vx: c.flow_x,
        vz: c.flow_z,
        ..Steer::default()
    }
}

/// ROOTED — golems and chompers. They still FACE you (the oracle kept steering
/// and multiplied the step by zero, so the walk clip and the facing both keep
/// updating); `rooted` is what stops the feet and the separation shove.
fn rooted(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    Steer {
        rooted: true,
        ..chase(a, c)
    }
}

/// PHASE — the ghost and the Death Dealer. Straight at the knight, through
/// walls: no field, no collision.
fn phase(_a: &mut MoveActor, c: &MoveCtx) -> Steer {
    let (ux, uz) = to_player(c);
    Steer {
        vx: ux,
        vz: uz,
        ..Steer::default()
    }
}

/// INERT — the bowling pin. No steering at all; something else integrates the
/// slide a knockback handed it.
///
/// The row exists so the table stays TOTAL: without it a pin would resolve to
/// `chase` the day someone edits the dispatch, and a chasing bowling pin is a
/// bug nobody would think to look for.
fn inert(_a: &mut MoveActor, _c: &MoveCtx) -> Steer {
    Steer { hold: true, ..ZERO }
}

/// FLANKER — comes at you from the side.
///
/// Rotate the baseline heading by an angle that FADES OUT as it arrives: full
/// `FLANK_ANGLE` beyond `FLANK_FAR`, straight in inside `FLANK_CLOSE`. So it
/// cannot orbit forever (a bounded rotation of a CONVERGING field, not a
/// tangent) and it always lands its bite — it just refuses to walk down the
/// corridor you are pointing your sword at.
fn flanker(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    let base = chase(a, c);
    if base.vx == 0.0 && base.vz == 0.0 {
        return base;
    }
    let k = clamp01((c.pdist - FLANK_CLOSE) / (FLANK_FAR - FLANK_CLOSE).max(1e-4));
    if k <= 0.0 {
        return base;
    }
    let (vx, vz) = rot(base.vx, base.vz, FLANK_ANGLE * k * side(a));
    Steer {
        vx,
        vz,
        tell: Some(MoveTell {
            color: tell::FLANK,
            k: k * 0.75,
        }),
        ..Steer::default()
    }
}

/// STRAFER — holds a range and circles it, then commits on a cadence.
///
/// Radial error drives it back to `STRAFE_RANGE`; the rest of the budget goes
/// TANGENTIAL, so it sidesteps instead of closing. Every `STRAFE_DART_CD`
/// seconds it spends `STRAFE_DART_TIME` driving straight in — the circling is
/// the rest state, the dart is the threat, and the tint goes hot
/// `STRAFE_TELL_LEAD` seconds early so the commit is readable rather than a
/// surprise.
fn strafer(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    a.move_t += c.dt;
    let (ux, uz) = to_player(c);
    if ux == 0.0 && uz == 0.0 {
        return ZERO;
    }

    // Mid-dart: straight in, fast, unmistakably committed.
    if a.move_commit > 0.0 {
        a.move_commit = (a.move_commit - c.dt).max(0.0);
        return Steer {
            vx: ux,
            vz: uz,
            mult: STRAFE_DART_MULT,
            tell: Some(MoveTell {
                color: tell::COMMIT,
                k: 1.0,
            }),
            ..Steer::default()
        };
    }
    if a.move_t >= STRAFE_DART_CD {
        a.move_t = 0.0;
        a.move_commit = STRAFE_DART_TIME;
        return Steer {
            vx: ux,
            vz: uz,
            mult: STRAFE_DART_MULT,
            tell: Some(MoveTell {
                color: tell::COMMIT,
                k: 1.0,
            }),
            ..Steer::default()
        };
    }

    // Circling. Radial pull toward the band, tangential the rest of the way.
    let err = c.pdist - STRAFE_RANGE.max(c.contact_range * 1.2);
    let radial = (err / STRAFE_BAND).clamp(-1.0, 1.0);
    let s = side(a);
    let (vx, vz) = unit(ux * radial - uz * s, uz * radial + ux * s);
    // The tell ramps INTO the dart — amber at rest, hot in the last beat.
    let lead =
        clamp01((a.move_t - (STRAFE_DART_CD - STRAFE_TELL_LEAD)) / STRAFE_TELL_LEAD.max(1e-4));
    Steer {
        vx,
        vz,
        tell: Some(if lead > 0.0 {
            MoveTell {
                color: tell::COMMIT,
                k: lead,
            }
        } else {
            MoveTell {
                color: tell::STRAFE,
                k: 0.55,
            }
        }),
        ..Steer::default()
    }
}

/// AMBUSHER — does not exist until it does.
///
/// It holds ABSOLUTELY still (no walk clip, no drift, no tell) while it has no
/// line of sight or you are far. The stillness IS the telegraph: in a floor
/// where everything shambles toward you, the thing that never moved is the
/// thing you walked past. When both conditions land it commits ONCE and for
/// good — a bright flash, then a burst for `AMBUSH_BURST_TIME`.
///
/// It never re-hides. An ambusher that resets is a stealth mechanic; this is a
/// trap, and a trap only springs once.
fn ambusher(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    if a.move_commit <= 0.0 {
        if c.los && c.pdist <= AMBUSH_RANGE {
            a.move_commit = 1.0;
            a.move_t = 0.0;
        } else {
            return Steer { hold: true, ..ZERO };
        }
    }
    a.move_t += c.dt;
    let base = chase(a, c);
    let burst = a.move_t < AMBUSH_BURST_TIME;
    Steer {
        mult: if burst { AMBUSH_BURST_MULT } else { 1.0 },
        tell: if burst {
            Some(MoveTell {
                color: tell::COMMIT,
                k: 1.0 - a.move_t / AMBUSH_BURST_TIME,
            })
        } else {
            None
        },
        ..base
    }
}

/// ORBITER — rings you at radius and spirals in.
///
/// Pure tangential motion with a radial correction back onto the ring, so the
/// path is a circle rather than a line. The ring TIGHTENS at `ORBIT_TIGHTEN`
/// per second (floored at its own bite range) — an orbiter that held its radius
/// forever would be a decoration you could ignore, and this way the fantasy
/// ("it's circling") and the threat ("and it's getting closer") are one motion.
fn orbiter(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    a.move_t += c.dt;
    let (ux, uz) = to_player(c);
    if ux == 0.0 && uz == 0.0 {
        return ZERO;
    }
    let want = c.contact_range.max(ORBIT_RADIUS - ORBIT_TIGHTEN * a.move_t);
    let radial = ((c.pdist - want) / ORBIT_BAND).clamp(-1.0, 1.0);
    let s = side(a);
    let (vx, vz) = unit(ux * radial - uz * s, uz * radial + ux * s);
    Steer {
        vx,
        vz,
        tell: Some(MoveTell {
            color: tell::ORBIT,
            k: 0.6,
        }),
        ..Steer::default()
    }
}

/// LEAPER — crouch, then a committed pounce along a CURVED line.
///
/// Three phases on one clock, all readable: cruise (closes at
/// `LEAP_CRUISE_MULT`, no tell) · crouch (dead stop, tint ramping to full red
/// over `LEAP_WINDUP` — the whole skill test is that window) · pounce
/// (`LEAP_TIME` of locked heading at `LEAP_SPEED_MULT`, the heading rotating at
/// `LEAP_CURVE` rad/s so the path is an ARC).
///
/// The arc is the point. A straight dash is dodged by stepping sideways once;
/// an arc has to be READ, because it bends toward where you are going. The
/// heading is locked at crouch-exit and never re-aimed, so a leap can be
/// BAITED — the counterplay the telegraph promises.
///
/// `move_commit` encodes the phase: >1 crouching (crouch time left + 1), in
/// (0,1] pouncing (pounce time left), <=0 recovering.
fn leaper(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    let (ux, uz) = to_player(c);
    let commit = a.move_commit;

    // ── Pounce: locked arc, no re-aim. ──
    if commit > 0.0 && commit <= 1.0 {
        a.move_commit = commit - c.dt;
        let (rx, rz) = rot(
            if a.move_dir_x == 0.0 && a.move_dir_z == 0.0 {
                ux
            } else {
                a.move_dir_x
            },
            if a.move_dir_x == 0.0 && a.move_dir_z == 0.0 {
                uz
            } else {
                a.move_dir_z
            },
            LEAP_CURVE * side(a) * c.dt,
        );
        a.move_dir_x = rx;
        a.move_dir_z = rz;
        if a.move_commit <= 0.0 {
            a.move_commit = 0.0;
            a.move_t = -LEAP_CD; // recovery: the clock has to climb back to 0
        }
        return Steer {
            vx: rx,
            vz: rz,
            mult: LEAP_SPEED_MULT,
            locked: true,
            ..Steer::default()
        };
    }

    // ── Crouch: rooted, tell ramping, heading aimed until the last frame. ──
    if commit > 1.0 {
        let left = commit - 1.0 - c.dt;
        a.move_dir_x = ux;
        a.move_dir_z = uz;
        if left <= 0.0 {
            a.move_commit = LEAP_TIME; // release
            return Steer {
                vx: ux,
                vz: uz,
                mult: LEAP_SPEED_MULT,
                locked: true,
                tell: Some(MoveTell {
                    color: tell::LEAP,
                    k: 1.0,
                }),
                ..Steer::default()
            };
        }
        a.move_commit = left + 1.0;
        return Steer {
            hold: true,
            tell: Some(MoveTell {
                color: tell::LEAP,
                k: 1.0 - left / LEAP_WINDUP,
            }),
            ..ZERO
        };
    }

    // ── Cruise / recover. ──
    a.move_t += c.dt;
    if a.move_t >= 0.0 && c.pdist <= LEAP_RANGE && c.pdist >= LEAP_MIN_RANGE && c.los {
        a.move_commit = LEAP_WINDUP + 1.0;
        return Steer {
            hold: true,
            tell: Some(MoveTell {
                color: tell::LEAP,
                k: 0.0,
            }),
            ..ZERO
        };
    }
    Steer {
        mult: LEAP_CRUISE_MULT,
        ..chase(a, c)
    }
}

/// PACK-HUNTER — will not fight you alone.
///
/// While fewer than `PACK_MIN` foes are within `PACK_RANGE` it STALKS: shadows
/// you at `PACK_HOLD_RANGE` at half speed, closing no further. The moment the
/// count lands — or one neighbour commits — the whole pack goes at once,
/// because `pack_committed` propagates: the first to commit drags the rest in
/// on the same frame, which is what makes the surge read as a DECISION rather
/// than as several monsters happening to arrive.
fn packhunter(a: &mut MoveActor, c: &MoveCtx) -> Steer {
    if a.move_commit <= 0.0 {
        if f64::from(c.pack_near) >= PACK_MIN || c.pack_committed {
            a.move_commit = 1.0;
        } else {
            let (ux, uz) = to_player(c);
            if ux == 0.0 && uz == 0.0 {
                return Steer { hold: true, ..ZERO };
            }
            // Shadow at the hold range: close if further, ease off if nearer.
            if c.pdist <= PACK_HOLD_RANGE {
                return Steer {
                    vx: -ux,
                    vz: -uz,
                    mult: PACK_STALK_MULT,
                    tell: Some(MoveTell {
                        color: tell::PACK,
                        k: 0.7,
                    }),
                    ..Steer::default()
                };
            }
            return Steer {
                mult: PACK_STALK_MULT,
                tell: Some(MoveTell {
                    color: tell::PACK,
                    k: 0.7,
                }),
                ..chase(a, c)
            };
        }
    }
    Steer {
        mult: PACK_RUSH_MULT,
        ..chase(a, c)
    }
}

/// THE DISPATCH. Exhaustive by the compiler — there is no `_` arm, so a new
/// `MovementKind` is a build error rather than a monster that silently inherits
/// `chase`. That is the Rust form of the oracle's "table has no fall-through".
pub fn steer(kind: MovementKind, a: &mut MoveActor, c: &MoveCtx) -> Steer {
    match kind {
        MovementKind::Chase => chase(a, c),
        MovementKind::Kite => kite(a, c),
        MovementKind::Rooted => rooted(a, c),
        MovementKind::Phase => phase(a, c),
        MovementKind::Inert => inert(a, c),
        MovementKind::Flanker => flanker(a, c),
        MovementKind::Strafer => strafer(a, c),
        MovementKind::Ambusher => ambusher(a, c),
        MovementKind::Orbiter => orbiter(a, c),
        MovementKind::Leaper => leaper(a, c),
        MovementKind::PackHunter => packhunter(a, c),
    }
}

/// True while the actor is mid-POUNCE. Nothing may interrupt a committed arc —
/// not a contact windup, not a shove. A telegraph that can be cancelled by the
/// thing it was telegraphing is not a telegraph.
///
/// The CROUCH is deliberately NOT covered: walking into a crouching leaper
/// should get you bitten, and `cancel_commit` turns the wind-up into that bite.
pub fn is_committed(kind: MovementKind, a: &MoveActor) -> bool {
    kind == MovementKind::Leaper && a.move_commit > 0.0 && a.move_commit <= 1.0
}

/// Drop any in-progress commit — the actor is doing something else now.
pub fn cancel_commit(a: &mut MoveActor) {
    a.move_commit = 0.0;
}

/// Which policies need a line-of-sight probe — the only cost worth paying for.
pub fn needs_los(kind: MovementKind) -> bool {
    matches!(kind, MovementKind::Ambusher | MovementKind::Leaper)
}

/// Which policies need the O(n) neighbour census. Only one, and it is rare.
pub fn needs_pack(kind: MovementKind) -> bool {
    kind == MovementKind::PackHunter
}
