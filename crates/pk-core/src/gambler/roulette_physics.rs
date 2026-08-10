//! ROULETTE PHYSICS — a real ball on a real wheel, then aimed. Port of
//! `legacy/src/scenes/tavern/gambler/roulette-physics.ts`.
//!
//! Two bodies (the spinning ROTOR carrying the pockets; the stationary BOWL
//! carrying the ball track and the deflectors), three phases (track → drop →
//! scatter/rattle), and the reconciliation: the outcome is drawn before the
//! ball moves, and `plan_spin` SEARCHES physically plausible launch speeds for
//! an untouched trajectory that happens to land in that pocket. Every frame
//! the player sees is a genuine solution of the model.

use crate::rng::Mulberry32;

/// Fixed simulation step. The trajectory is baked at this rate, then replayed.
pub const DT: f64 = 1.0 / 120.0;

/// Pockets on this wheel — 0 plus 1..18. Must match `roulette.rs`.
const POCKETS: i32 = 19;
/// Angular width of one pocket, radians.
pub const POCKET_PITCH: f64 = std::f64::consts::PI * 2.0 / POCKETS as f64;

/// Ball track radius in metres. A casino wheel is ~0.30 m to the ball track.
const R_TRACK_M: f64 = 0.3;
/// Incline of the banked track wall.
const TRACK_ALPHA: f64 = std::f64::consts::FRAC_PI_4;
const G: f64 = 9.81;

/// Critical angular velocity: below this the ball cannot hold the banked
/// track. w_crit = sqrt(g * tan(alpha) / r) ≈ 5.72 rad/s.
pub fn w_crit() -> f64 {
    ((G * libm::tan(TRACK_ALPHA)) / R_TRACK_M).sqrt()
}

/// Rolling friction: a near-constant retarding torque. rad/s^2.
const K_ROLL: f64 = 0.55;
/// Air drag: proportional to speed. 1/s.
const K_DRAG: f64 = 0.52;
/// Extra drag once the ball is off the track and skidding across the apron.
const K_APRON: f64 = 1.15;
/// Drag on the pocket ring, against the ROTOR-relative speed.
const K_RING: f64 = 1.5;
/// Deflector strikes before the ball is committed to the ring.
const MAX_DEFLECTOR_HITS: u32 = 3;

/// Rotor friction. It must still be turning when the ball lands, so: small.
const K_ROTOR: f64 = 0.075;

/// Normalised radii. 1.0 is the ball track; the renderer scales these.
pub const R_BALL_TRACK: f64 = 1.0;
pub const R_DEFLECTOR: f64 = 0.8;
pub const R_POCKET: f64 = 0.66;

/// Deflectors on the stationary bowl. Evenly spaced, per Eichberger.
pub const DEFLECTORS: u32 = 8;
const DEFL_OFFSET: f64 = 0.21;

/// Launch speed window searched for a trajectory, rad/s. ~3 to 3.9 rev/s.
const W0_MIN: f64 = 19.0;
const W0_MAX: f64 = 24.5;
/// Candidate launch speeds tried. Chaos means every pocket is reachable.
const W0_STEPS: u32 = 600;
/// Distinct scatter seeds tried if a whole launch-speed sweep misses.
/// MEASURED: one sweep misses with q ≈ 0.041; failure rate is q^SEED_TRIES —
/// 3 reddened the suite on ~2% of runs; 6 is ~4e-9 (never).
pub const SEED_TRIES: u32 = 6;

/// Rotor launch speed window, rad/s. Negative: it counter-rotates.
const ROTOR_MIN: f64 = 1.15;
const ROTOR_MAX: f64 = 1.75;

/// Below this rotor-relative speed the ball has stopped rattling and seats.
const SEAT_W: f64 = 0.42;

/// How long the ball rides round in its pocket before the sim ends, seconds.
const RIDE_TIME: f64 = 0.7;
/// When the ring drag starts ramping up hard, seconds — bounds the spin.
const DAMP_FROM: f64 = 3.6;
/// Hard cap so a pathological candidate can never hang the frame.
const MAX_FRAMES: usize = 900;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Track,
    Drop,
    Scatter,
    Rattle,
    Seated,
}

/// What the ball struck this frame, so audio and art can react to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitKind {
    None,
    Deflector,
    Fret,
    Seat,
}

#[derive(Debug, Clone, Copy)]
pub struct BallFrame {
    /// Ball angle in the world frame, radians.
    pub theta: f64,
    /// Rotor angle in the world frame. The pockets are indexed off this.
    pub rotor: f64,
    /// Normalised radius: 1 = ball track, `R_POCKET` = seated.
    pub radius: f64,
    /// Height above the pocket floor, 0..1.
    pub height: f64,
    /// Ball speed, rad/s. Drives the rattle pitch.
    pub omega: f64,
    pub phase: Phase,
    pub hit: HitKind,
}

#[derive(Debug, Clone)]
pub struct Spin {
    pub frames: Vec<BallFrame>,
    /// The pocket the ball is in on the last frame. Guaranteed == the decision.
    pub pocket: i32,
    /// Seconds the whole trajectory lasts.
    pub duration: f64,
    /// True if the search found a natural trajectory into the target pocket.
    pub natural: bool,
    /// Residual angle folded into the final seat. Zero whenever `natural`.
    pub correction: f64,
}

/// Which pocket a world-frame ball angle is over, given the rotor's angle.
pub fn pocket_at(theta: f64, rotor: f64) -> i32 {
    let rel = theta - rotor;
    // JS Math.round + `%` on a possibly-negative result, mirrored: JS % is a
    // remainder (sign of the dividend), same as Rust's %.
    let idx = js_round(rel / POCKET_PITCH) % POCKETS;
    if idx < 0 {
        idx + POCKETS
    } else {
        idx
    }
}

/// JS `Math.round`: half-away-from... actually half-UP (round(-0.5) is -0).
fn js_round(x: f64) -> i32 {
    libm::floor(x + 0.5) as i32
}

/// Wrap to (-pi, pi].
fn wrap_pi(a: f64) -> f64 {
    let mut x = a % (std::f64::consts::PI * 2.0);
    if x > std::f64::consts::PI {
        x -= std::f64::consts::PI * 2.0;
    }
    if x <= -std::f64::consts::PI {
        x += std::f64::consts::PI * 2.0;
    }
    x
}

/// Angular distance from `a` to the nearest deflector, signed, wrapped.
fn to_next_deflector(a: f64) -> f64 {
    let step = std::f64::consts::PI * 2.0 / f64::from(DEFLECTORS);
    let rel = a - DEFL_OFFSET;
    step - (((rel % step) + step) % step)
}

/// Integrate one launch to a rest, appending every step to `out`. This is the
/// whole model, and nothing in it knows what pocket we want.
pub fn simulate_into(out: &mut Vec<BallFrame>, w0: f64, rotor_w0: f64, seed: u32) {
    out.clear();
    let mut rng = Mulberry32::new(seed);
    let mut rand = move || rng.next_f64();

    let mut theta = 0.0;
    let mut w = w0;
    // The rotor runs the other way — this one minus makes it counter-rotate.
    let mut rotor = rand() * std::f64::consts::PI * 2.0;
    let mut rotor_w = -rotor_w0;

    let mut radius = R_BALL_TRACK;
    let mut height = 1.0;
    // Vertical velocity in normalised height units per second.
    let mut vh = 0.0;
    let mut phase = Phase::Track;
    let mut hit = HitKind::None;
    // Rotor-frame fret boundary last crossed, so we count each once.
    let mut last_fret: Option<i32> = None;
    let mut ride_left = RIDE_TIME;
    let mut defl_hits: u32 = 0;
    // Seconds spent between leaving the track and committing to the ring.
    let mut apron_t = 0.0;

    for i in 0..MAX_FRAMES {
        out.push(BallFrame {
            theta,
            rotor,
            radius,
            height,
            omega: w,
            phase,
            hit,
        });
        hit = HitKind::None;

        // ── Rotor ── friction only; never reverses or stalls mid-spin.
        if rotor_w < 0.0 {
            rotor_w = (rotor_w + K_ROTOR * DT).min(0.0);
        }
        rotor += rotor_w * DT;

        if phase == Phase::Seated {
            ride_left -= DT;
            // Locked to the rotor: the ball is a passenger now.
            theta += rotor_w * DT;
            w = rotor_w;
            if ride_left <= 0.0 {
                break;
            }
            continue;
        }

        if phase == Phase::Track {
            // Rolling friction (constant) + air drag (linear in speed).
            w -= (K_ROLL + K_DRAG * w) * DT;
            theta += w * DT;
            // The departure condition. Above w_crit the banked wall holds it up.
            if w <= w_crit() {
                phase = Phase::Drop;
                vh = 0.0;
            }
        } else if phase == Phase::Drop || phase == Phase::Scatter {
            // ── Off the wall ── skids down the apron onto the deflector ring
            // and works inward, striking diamonds as it goes.
            apron_t += DT;
            w -= (K_ROLL + K_APRON * w) * DT;
            let before = theta;
            theta += w * DT;

            // Radial fall: quick onto the deflector ring, then inward a step
            // per strike until it commits to the pocket ring.
            let r_target = if defl_hits == 0 {
                R_DEFLECTOR
            } else {
                (R_DEFLECTOR - f64::from(defl_hits) * 0.055).max(R_POCKET)
            };
            radius = (radius - 1.5 * DT).max(r_target);

            // Vertical: ballistic between contacts, floored at the apron.
            vh -= 4.4 * DT;
            height = (height + vh * DT).max(0.4);
            if height <= 0.4 {
                vh = vh.max(0.0);
            }

            // Did we sweep past a deflector this step? They are on the
            // STATIONARY bowl, so this test is in world angle, no rotor term.
            let on_ring = radius <= R_DEFLECTOR + 0.02 && height <= 0.45;
            if on_ring
                && (theta - before).abs() >= to_next_deflector(before)
                && defl_hits < MAX_DEFLECTOR_HITS
            {
                // The scatter: most of the speed dies here, and the kick that
                // survives is the part no model claims to predict.
                w *= 0.34 + rand() * 0.3;
                w += (rand() - 0.5) * 1.5;
                vh = 0.34 + rand() * 0.32;
                defl_hits += 1;
                phase = Phase::Scatter;
                hit = HitKind::Deflector;
            } else if defl_hits >= MAX_DEFLECTOR_HITS
                || radius <= R_POCKET + 0.01
                // Too slow to reach the next diamond, or long enough up there.
                || (w - rotor_w).abs() < 1.5
                || apron_t > 1.15
            {
                // Committed. Fall the last bit onto the ring and start rattling.
                radius = R_POCKET;
                phase = Phase::Rattle;
                height = 0.12;
                vh = 0.0;
                last_fret = None;
            }
        } else {
            // ── rattle ── on the pocket ring, crossing frets. Drag acts on the
            // speed RELATIVE TO THE ROTOR; the ramp bounds the spin.
            let damp = K_RING * (1.0 + (i as f64 * DT - DAMP_FROM).max(0.0) * 3.0);
            w -= damp * (w - rotor_w) * DT;
            theta += w * DT;
            radius = R_POCKET;

            // Fret boundaries live in the ROTOR's frame.
            let rel = theta - rotor;
            let fret = js_round(rel / POCKET_PITCH - 0.5);
            if let Some(last) = last_fret {
                if fret != last {
                    // A fret takes a bite out of the ball's ring-relative speed.
                    let rel_w = w - rotor_w;
                    w = rotor_w + rel_w * (0.74 + rand() * 0.14);
                    vh = 0.13 + rand() * 0.1;
                    hit = HitKind::Fret;
                }
            }
            last_fret = Some(fret);

            vh -= 3.2 * DT;
            height = (height + vh * DT).max(0.0);
            if height <= 0.0 {
                height = 0.0;
                vh = 0.0;
            }

            if (w - rotor_w).abs() < SEAT_W && height <= 0.02 {
                // Seated. Snap to the pocket centre so the landing is exact.
                let idx = pocket_at(theta, rotor);
                theta = rotor + f64::from(idx) * POCKET_PITCH;
                phase = Phase::Seated;
                hit = HitKind::Seat;
                w = rotor_w;
                height = 0.0;
                vh = 0.0;
            }
        }
    }

    // A candidate that never seated (frame cap hit) still has to end somewhere.
    let last = out.last_mut().unwrap();
    if last.phase != Phase::Seated {
        let idx = pocket_at(last.theta, last.rotor);
        last.theta = last.rotor + f64::from(idx) * POCKET_PITCH;
        last.radius = R_POCKET;
        last.height = 0.0;
        last.phase = Phase::Seated;
    }
}

/// Produce a trajectory that lands in `target` — by SEARCH over launch speeds
/// (and scatter seeds), never by bending a trajectory. `correction` is the
/// belt to that braces and is 0.0 on every natural spin.
pub fn plan_spin(target: i32, rand: &mut dyn FnMut() -> f64) -> Spin {
    let rotor_w0 = ROTOR_MIN + rand() * (ROTOR_MAX - ROTOR_MIN);

    let mut frames: Vec<BallFrame> = Vec::new();
    let mut scratch: Vec<BallFrame> = Vec::new();
    let mut natural = false;
    let mut best_w0 = W0_MIN;
    let mut best_seed = 0u32;

    'outer: for s in 0..SEED_TRIES {
        let seed = (rand() * 4_294_967_295.0).floor() as u32;
        let start = (rand() * f64::from(W0_STEPS)).floor() as u32;
        if s == 0 {
            best_seed = seed;
        }
        for k in 0..W0_STEPS {
            let i = (start + k) % W0_STEPS;
            let w0 = W0_MIN + (f64::from(i) / f64::from(W0_STEPS - 1)) * (W0_MAX - W0_MIN);
            simulate_into(&mut scratch, w0, rotor_w0, seed);
            let end = scratch.last().unwrap();
            if s == 0 && k == 0 {
                best_w0 = w0;
            }
            if pocket_at(end.theta, end.rotor) == target {
                natural = true;
                best_w0 = w0;
                best_seed = seed;
                break 'outer;
            }
        }
    }

    simulate_into(&mut frames, best_w0, rotor_w0, best_seed);

    // ── Enforce the invariant ──
    let n = frames.len();
    let last = frames[n - 1];
    let want = last.rotor + f64::from(target) * POCKET_PITCH;
    let correction = wrap_pi(want - last.theta);
    if correction.abs() > 1e-9 {
        // Ease it in over the tail so it is a settle, not a teleport. Only
        // ever reached if the search failed, which the test forbids.
        let span = (n - 1).min((0.5 / DT).round() as usize);
        let from = n - 1 - span;
        for (i, f) in frames.iter_mut().enumerate().take(n).skip(from) {
            let u = (i - from) as f64 / span as f64;
            f.theta += correction * (u * u * (3.0 - 2.0 * u));
        }
    }

    let last = frames[frames.len() - 1];
    Spin {
        pocket: pocket_at(last.theta, last.rotor),
        duration: frames.len() as f64 * DT,
        frames,
        natural,
        correction,
    }
}

/// Sample the baked trajectory at a wall-clock time. Clamps at both ends.
pub fn frame_at(spin: &Spin, t: f64) -> BallFrame {
    let i = libm::floor(t / DT) as i64;
    if i <= 0 {
        return spin.frames[0];
    }
    let i = i as usize;
    if i >= spin.frames.len() {
        return spin.frames[spin.frames.len() - 1];
    }
    spin.frames[i]
}

/// Every hit between two times, so a variable-rate render loop cannot drop a
/// fret click. Audio reads this.
pub fn hits_between(spin: &Spin, t0: f64, t1: f64) -> Vec<HitKind> {
    let a = (libm::floor(t0 / DT).max(0.0)) as usize;
    let b = (libm::ceil(t1 / DT) as usize).min(spin.frames.len());
    let mut out = Vec::new();
    for i in a..b {
        if spin.frames[i].hit != HitKind::None {
            out.push(spin.frames[i].hit);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    //! Ported from the physics half of
    //! `legacy/src/scenes/tavern/gambler/roulette.test.ts`.
    use super::*;
    use crate::gambler::roulette::{bets, settle_bet, POCKETS as N_POCKETS};

    fn seeded(seed: u32) -> impl FnMut() -> f64 {
        let mut rng = Mulberry32::new(seed);
        move || rng.next_f64()
    }

    #[test]
    fn settles_in_the_decided_pocket_on_every_spin() {
        let mut rand = seeded(2026);
        for i in 0..400 {
            let target = i % N_POCKETS;
            let spin = plan_spin(target, &mut rand);
            let last = spin.frames.last().unwrap();
            assert_eq!(spin.pocket, target, "spin {i} was aimed at {target}");
            assert_eq!(pocket_at(last.theta, last.rotor), target);
        }
    }

    #[test]
    fn agrees_with_the_payout_for_every_bet_on_the_table() {
        let mut rand = seeded(31337);
        let table = bets();
        for i in 0..120 {
            let target = i % N_POCKETS;
            let bet = &table[(i as usize) % table.len()];
            let spin = plan_spin(target, &mut rand);
            let last = spin.frames.last().unwrap();
            let shown = pocket_at(last.theta, last.rotor);
            assert_eq!(settle_bet(bet, shown).0, settle_bet(bet, target).0);
            assert_eq!(settle_bet(bet, shown).1, settle_bet(bet, target).1);
        }
    }

    #[test]
    fn finishes_genuinely_seated_in_a_pocket_not_hovering_near_one() {
        let mut rand = seeded(99);
        for i in 0..60 {
            let spin = plan_spin(i % N_POCKETS, &mut rand);
            let last = spin.frames.last().unwrap();
            assert_eq!(last.phase, Phase::Seated);
            assert!((last.radius - R_POCKET).abs() < 1e-6);
            assert_eq!(last.height, 0.0);
        }
    }

    #[test]
    fn keeps_enough_seed_retries_that_the_search_effectively_never_fails() {
        const { assert!(SEED_TRIES >= 6) };
    }

    #[test]
    fn never_needs_the_emergency_correction() {
        let mut rand = seeded(777);
        for i in 0..300 {
            let spin = plan_spin(i % N_POCKETS, &mut rand);
            assert!(
                spin.natural,
                "spin aimed at {} fell back to a correction",
                i % N_POCKETS
            );
            assert!(spin.correction.abs() < 1e-9);
        }
    }

    #[test]
    fn holds_the_outcome_for_the_whole_replay_not_just_the_last_frame() {
        let mut rand = seeded(13);
        let spin = plan_spin(13, &mut rand);
        for t in [spin.duration - 0.001, spin.duration, spin.duration + 5.0] {
            let f = frame_at(&spin, t);
            assert_eq!(pocket_at(f.theta, f.rotor), 13);
        }
    }

    fn spin_of() -> Vec<BallFrame> {
        plan_spin(7, &mut seeded(7)).frames
    }

    #[test]
    fn counter_rotates_the_ball_runs_against_the_rotor() {
        let frames = spin_of();
        let track: Vec<_> = frames.iter().filter(|f| f.phase == Phase::Track).collect();
        assert!(track.len() > 60);
        assert!(track[track.len() - 1].theta > track[0].theta);
        assert!(track[track.len() - 1].rotor < track[0].rotor);
    }

    #[test]
    fn keeps_the_rotor_turning_until_the_ball_is_down() {
        let frames = spin_of();
        let seat = frames
            .iter()
            .position(|f| f.phase == Phase::Seated)
            .unwrap();
        assert!(frames[seat].rotor < frames[seat - 30].rotor);
    }

    #[test]
    fn only_leaves_the_track_once_it_is_below_the_critical_velocity() {
        let frames = spin_of();
        for f in &frames {
            if f.phase == Phase::Track {
                assert!(f.omega > w_crit() - 0.2);
            }
        }
        let drop = frames.iter().find(|f| f.phase == Phase::Drop).unwrap();
        assert!(drop.omega <= w_crit());
    }

    #[test]
    fn loses_energy_monotonically_while_on_the_track() {
        let track: Vec<_> = spin_of()
            .into_iter()
            .filter(|f| f.phase == Phase::Track)
            .collect();
        for i in 1..track.len() {
            assert!(track[i].omega < track[i - 1].omega);
        }
    }

    #[test]
    fn strikes_a_deflector_on_the_way_down() {
        let mut rand = seeded(40);
        for i in 0..40 {
            let frames = plan_spin(i % N_POCKETS, &mut rand).frames;
            assert!(frames.iter().any(|f| f.hit == HitKind::Deflector));
        }
    }

    #[test]
    fn stays_inside_the_bowl_for_the_whole_trajectory() {
        for f in spin_of() {
            assert!(f.radius <= 1.0 + 1e-9);
            assert!(f.radius >= R_POCKET - 1e-9);
            assert!(f.height >= 0.0);
            assert!(f.height <= 1.0 + 1e-9);
        }
    }

    #[test]
    fn moves_inward_never_back_out_to_the_track() {
        let frames = spin_of();
        for i in 1..frames.len() {
            assert!(frames[i].radius <= frames[i - 1].radius + 1e-9);
        }
    }

    #[test]
    fn takes_between_three_and_six_seconds() {
        let mut rand = seeded(60);
        for i in 0..60 {
            let d = plan_spin(i % N_POCKETS, &mut rand).duration;
            assert!(d > 3.0, "duration {d}");
            assert!(d < 6.0, "duration {d}");
        }
    }

    #[test]
    fn is_deterministic_the_same_launch_and_seed_replays_exactly() {
        let mut a: Vec<BallFrame> = Vec::new();
        let mut b: Vec<BallFrame> = Vec::new();
        simulate_into(&mut a, 21.5, 1.4, 12345);
        simulate_into(&mut b, 21.5, 1.4, 12345);
        assert_eq!(a.len(), b.len());
        assert_eq!(a.last().unwrap().theta, b.last().unwrap().theta);
    }

    #[test]
    fn bakes_frames_at_the_fixed_step_it_claims_to() {
        let spin = plan_spin(3, &mut seeded(3));
        assert!((spin.duration - spin.frames.len() as f64 * DT).abs() < 1e-9);
    }
}
