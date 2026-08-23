//! THE MEASUREMENT — ported from `entities/movement.test.ts`.
//!
//! A movement type that measures identical to `chase` is a LABEL, not a
//! behaviour, and the only way to know which one shipped is to walk the policy
//! and measure the path it draws. So: put an actor in an open room with the
//! player at the origin, hand it a flow heading that points straight at the
//! player (the field's job is done by the direct line there, so any deviation
//! in the path is the POLICY's doing and not the maze's), run it at the game's
//! fixed 60 Hz, and record the path.
//!
//! Every policy is then asserted against `chase` on ONE named quantity:
//!
//! | policy | quantity |
//! |---|---|
//! | flanker | mean off-axis angle (rad) |
//! | strafer | mean held range + tangential share |
//! | ambusher | displacement while out of sight — must be EXACTLY zero |
//! | orbiter | range variance + tangential share |
//! | leaper | path curvature (rad/s) + peak speed |
//! | packhunter | closest approach, alone vs. in a quorum |
//!
//! These are the quantities themselves, not proxies for them: the numbers come
//! from running the code, not from reading it. The thresholds are the oracle's.

use pk_core::enemies::*;
use pk_core::movement::*;

const DT: f64 = 1.0 / 60.0;

fn actor() -> MoveActor {
    MoveActor {
        x: 0.0,
        z: 0.0,
        speed: 2.0,
        ..Default::default()
    }
}

/// A context with the player `dist` units away along +x, and a flow heading
/// that is deliberately NOT the direct line, so the two are distinguishable.
fn ctx(dist: f64) -> MoveCtx {
    MoveCtx {
        dt: DT,
        pdx: dist,
        pdz: 0.0,
        pdist: dist,
        flow_x: 0.0,
        flow_z: 1.0,
        contact_range: SPITTER_FIRE_RANGE,
        los: true,
        pack_near: 0,
        pack_committed: false,
    }
}

#[derive(Clone, Copy, Default)]
struct RunOpts {
    dist: f64,
    frames: usize,
    phase: Option<f64>,
    los: Option<bool>,
    pack_near: Option<i32>,
    contact_range: Option<f64>,
}

struct RunResult {
    path: Vec<(f64, f64)>,
    off_axis: f64,
    mean_range: f64,
    range_sd: f64,
    curvature: f64,
    tangential: f64,
    closest: f64,
    peak_mult: f64,
    displaced: f64,
}

/// Walk one policy through an open room and measure the path it draws.
fn run(kind: MovementKind, o: RunOpts) -> RunResult {
    let mut a = MoveActor {
        x: o.dist,
        z: 0.0,
        speed: 2.0,
        move_phase: o.phase.unwrap_or(0.9),
        ..Default::default()
    };
    let start = (a.x, a.z);
    let mut path = Vec::with_capacity(o.frames);
    let (mut off_sum, mut tan_sum, mut turn_sum) = (0.0, 0.0, 0.0);
    let mut peak: f64 = 0.0;
    let mut closest = f64::INFINITY;
    let mut prev_h: Option<(f64, f64)> = None;
    let mut ranges = Vec::with_capacity(o.frames);

    for _ in 0..o.frames {
        let (pdx, pdz) = (-a.x, -a.z);
        let pdist = pdx.hypot(pdz);
        let (ux, uz) = if pdist > 1e-6 {
            (pdx / pdist, pdz / pdist)
        } else {
            (0.0, 0.0)
        };
        let c = MoveCtx {
            dt: DT,
            pdx,
            pdz,
            pdist,
            // Open room: the flow field's answer IS the direct line.
            flow_x: ux,
            flow_z: uz,
            contact_range: o.contact_range.unwrap_or(0.7),
            los: o.los.unwrap_or(true),
            pack_near: o.pack_near.unwrap_or(1),
            pack_committed: false,
        };
        let s = steer(kind, &mut a, &c);
        let step = a.speed * s.mult * DT;
        let h = s.vx.hypot(s.vz);
        if h > 1e-6 {
            let (hx, hz) = (s.vx / h, s.vz / h);
            off_sum += (hx * ux + hz * uz).clamp(-1.0, 1.0).acos();
            tan_sum += (hx * -uz + hz * ux).abs();
            if let Some((px, pz)) = prev_h {
                turn_sum += (hx * px + hz * pz).clamp(-1.0, 1.0).acos() / DT;
            }
            prev_h = Some((hx, hz));
            a.x += hx * step;
            a.z += hz * step;
        }
        peak = peak.max(if h > 1e-6 { s.mult } else { 0.0 });
        let d = a.x.hypot(a.z);
        ranges.push(d);
        closest = closest.min(d);
        path.push((a.x, a.z));
    }

    let n = o.frames as f64;
    let mean_range = ranges.iter().sum::<f64>() / ranges.len() as f64;
    let range_sd =
        (ranges.iter().map(|r| (r - mean_range).powi(2)).sum::<f64>() / ranges.len() as f64).sqrt();
    RunResult {
        path,
        off_axis: off_sum / n,
        mean_range,
        range_sd,
        curvature: turn_sum / n,
        tangential: tan_sum / n,
        closest,
        peak_mult: peak,
        displaced: (a.x - start.0).hypot(a.z - start.1),
    }
}

// ── Dispatch is total ───────────────────────────────────────────────────────

/// The Rust form of "no kind falls through to another kind's steering": the
/// `match` in `steer` has no `_` arm, so this is enforced at compile time. What
/// the list checks is that `MOVEMENT_KINDS` did not drift from the enum.
#[test]
fn every_kind_is_listed_and_steers() {
    assert_eq!(MOVEMENT_KINDS.len(), 11);
    let mut seen = std::collections::HashSet::new();
    for k in MOVEMENT_KINDS {
        assert!(seen.insert(k), "{k:?} listed twice");
        let s = steer(k, &mut actor(), &ctx(5.0));
        assert!(s.vx.is_finite() && s.vz.is_finite(), "{k:?}");
    }
}

// ── chase — the baseline the cascade used to hard-code ──────────────────────

#[test]
fn chase_steers_straight_at_the_player_inside_direct_range() {
    let s = steer(
        MovementKind::Chase,
        &mut actor(),
        &ctx(DIRECT_STEER_RANGE - 0.1),
    );
    assert!((s.vx - 1.0).abs() < 1e-6, "vx {}", s.vx);
    assert!(s.vz.abs() < 1e-6, "vz {}", s.vz);
}

#[test]
fn chase_follows_the_flow_field_beyond_it() {
    let s = steer(
        MovementKind::Chase,
        &mut actor(),
        &ctx(DIRECT_STEER_RANGE + 0.1),
    );
    assert!(s.vx.abs() < 1e-6);
    assert!((s.vz - 1.0).abs() < 1e-6);
}

#[test]
fn chase_stands_still_with_no_field_and_out_of_direct_range() {
    let mut c = ctx(6.0);
    c.flow_x = 0.0;
    c.flow_z = 0.0;
    let s = steer(MovementKind::Chase, &mut actor(), &c);
    assert_eq!((s.vx, s.vz), (0.0, 0.0));
}

#[test]
fn chase_does_not_divide_by_zero_standing_on_the_player() {
    let s = steer(MovementKind::Chase, &mut actor(), &ctx(0.0));
    assert!(s.vx.is_finite() && s.vz.is_finite());
}

// ── kite — the spitter's range game ─────────────────────────────────────────

#[test]
fn kite_retreats_inside_the_kite_range() {
    let s = steer(
        MovementKind::Kite,
        &mut actor(),
        &ctx(SPITTER_KITE_RANGE - 0.2),
    );
    assert!((s.vx + 1.0).abs() < 1e-6, "vx {}", s.vx);
}

#[test]
fn kite_holds_between_the_kite_range_and_its_fire_range() {
    let s = steer(
        MovementKind::Kite,
        &mut actor(),
        &ctx((SPITTER_KITE_RANGE + SPITTER_FIRE_RANGE) / 2.0),
    );
    assert_eq!((s.vx, s.vz), (0.0, 0.0));
}

#[test]
fn kite_paths_in_beyond_its_fire_range() {
    let s = steer(
        MovementKind::Kite,
        &mut actor(),
        &ctx(SPITTER_FIRE_RANGE + 2.0),
    );
    assert!((s.vz - 1.0).abs() < 1e-6, "the flow heading");
}

// ── rooted / phase / inert ──────────────────────────────────────────────────

#[test]
fn rooted_still_faces_you_but_flags_itself_immovable() {
    let s = steer(
        MovementKind::Rooted,
        &mut actor(),
        &ctx(DIRECT_STEER_RANGE - 0.1),
    );
    assert!(s.rooted);
    assert!((s.vx - 1.0).abs() < 1e-6);
}

#[test]
fn phase_ignores_the_flow_field_entirely() {
    let s = steer(MovementKind::Phase, &mut actor(), &ctx(12.0));
    assert!((s.vx - 1.0).abs() < 1e-6);
    assert!(s.vz.abs() < 1e-6);
}

#[test]
fn inert_never_steers_and_never_plays_a_walk() {
    let s = steer(MovementKind::Inert, &mut actor(), &ctx(3.0));
    assert_eq!((s.vx, s.vz), (0.0, 0.0));
    assert!(s.hold);
}

// ── purity ──────────────────────────────────────────────────────────────────

/// The co-op contract in one assertion: two peers stepping the same actor
/// through the same frames must produce the same path, forever. An RNG draw
/// anywhere in here would fail this within a few frames.
#[test]
fn no_rng_the_same_actor_and_context_replay_identically() {
    for k in MOVEMENT_KINDS {
        let a = run(
            k,
            RunOpts {
                dist: 8.0,
                frames: 400,
                ..Default::default()
            },
        );
        let b = run(
            k,
            RunOpts {
                dist: 8.0,
                frames: 400,
                ..Default::default()
            },
        );
        assert_eq!(a.path, b.path, "{k:?} did not replay identically");
    }
}

#[test]
fn every_kind_returns_finite_headings_at_every_range() {
    for k in MOVEMENT_KINDS {
        for d in [0.0, 0.0001, 0.5, 1.6, 3.0, 7.0, 40.0] {
            let s = steer(k, &mut actor(), &ctx(d));
            assert!(s.vx.is_finite() && s.vz.is_finite(), "{k:?} @ {d}");
        }
    }
}

// ── MEASURED: every policy draws a different path than chase ────────────────

#[test]
fn flanker_walks_measurably_off_the_direct_line() {
    let base = run(
        MovementKind::Chase,
        RunOpts {
            dist: 9.0,
            frames: 300,
            ..Default::default()
        },
    );
    let flank = run(
        MovementKind::Flanker,
        RunOpts {
            dist: 9.0,
            frames: 300,
            ..Default::default()
        },
    );
    // Chase in an open room is the direct line by construction: zero off-axis.
    assert!(base.off_axis < 0.01, "chase off-axis {}", base.off_axis);
    // The flanker holds a real angle across it. Oracle measured ~0.63 rad ≈ 36°.
    assert!(flank.off_axis > 0.5, "flanker off-axis {}", flank.off_axis);
    assert!(flank.off_axis / base.off_axis.max(1e-6) > 10.0);
    // …and it STILL ARRIVES. An angle that never closes is an orbit, not a flank.
    let long = run(
        MovementKind::Flanker,
        RunOpts {
            dist: 9.0,
            frames: 500,
            ..Default::default()
        },
    );
    assert!(long.closest < FLANK_CLOSE, "closest {}", long.closest);
}

#[test]
fn flanker_peels_to_opposite_sides_for_opposite_phases() {
    let left = run(
        MovementKind::Flanker,
        RunOpts {
            dist: 9.0,
            frames: 120,
            phase: Some(0.1),
            ..Default::default()
        },
    );
    let right = run(
        MovementKind::Flanker,
        RunOpts {
            dist: 9.0,
            frames: 120,
            phase: Some(0.9),
            ..Default::default()
        },
    );
    let lz = left.path.last().unwrap().1;
    let rz = right.path.last().unwrap().1;
    assert!(
        lz.signum() == -rz.signum(),
        "phases must peel opposite ways: {lz} vs {rz}"
    );
    assert!(lz.abs() > 0.5, "and by a real amount: {lz}");
}

#[test]
fn strafer_holds_range_where_chase_closes_to_contact() {
    let base = run(
        MovementKind::Chase,
        RunOpts {
            dist: 9.0,
            frames: 900,
            ..Default::default()
        },
    );
    let straf = run(
        MovementKind::Strafer,
        RunOpts {
            dist: 9.0,
            frames: 900,
            ..Default::default()
        },
    );
    assert!(
        base.mean_range < 2.0,
        "chase mean range {}",
        base.mean_range
    );
    assert!(straf.mean_range > base.mean_range * 1.5);
    // And most of its motion is going AROUND, not IN.
    assert!(straf.tangential > 0.4, "tangential {}", straf.tangential);
    assert!(base.tangential < 0.05);
}

#[test]
fn strafer_darts_on_a_cadence_and_the_commit_is_a_real_speed_spike() {
    let straf = run(
        MovementKind::Strafer,
        RunOpts {
            dist: 5.0,
            frames: 600,
            ..Default::default()
        },
    );
    assert!((straf.peak_mult - STRAFE_DART_MULT).abs() < 1e-5);
    // The dart is what lets it actually reach you; without it, it is scenery.
    assert!(straf.closest < 2.0, "closest {}", straf.closest);
}

#[test]
fn ambusher_does_not_move_at_all_without_sight_and_springs_with_it() {
    let blind = run(
        MovementKind::Ambusher,
        RunOpts {
            dist: 4.0,
            frames: 400,
            los: Some(false),
            ..Default::default()
        },
    );
    // Not "small" — ZERO. It is a trap, not a shy chaser.
    assert_eq!(blind.displaced, 0.0);
    let sprung = run(
        MovementKind::Ambusher,
        RunOpts {
            dist: 4.0,
            frames: 400,
            los: Some(true),
            ..Default::default()
        },
    );
    assert!(sprung.closest < 1.0, "closest {}", sprung.closest);
    assert!((sprung.peak_mult - AMBUSH_BURST_MULT).abs() < 1e-5);
}

#[test]
fn ambusher_ignores_sight_it_has_from_outside_its_range() {
    let far = run(
        MovementKind::Ambusher,
        RunOpts {
            dist: AMBUSH_RANGE + 3.0,
            frames: 400,
            los: Some(true),
            ..Default::default()
        },
    );
    assert_eq!(far.displaced, 0.0);
}

#[test]
fn orbiter_rings_at_radius_and_never_closes_like_a_chaser() {
    let base = run(
        MovementKind::Chase,
        RunOpts {
            dist: 8.0,
            frames: 420,
            ..Default::default()
        },
    );
    let orb = run(
        MovementKind::Orbiter,
        RunOpts {
            dist: 8.0,
            frames: 420,
            ..Default::default()
        },
    );
    assert!(
        orb.tangential > 0.7,
        "almost pure sideways: {}",
        orb.tangential
    );
    assert!(base.tangential < 0.05);
    // It settles ONTO the ring and stays there.
    let settled = run(
        MovementKind::Orbiter,
        RunOpts {
            dist: ORBIT_RADIUS,
            frames: 420,
            ..Default::default()
        },
    );
    assert!(settled.range_sd < 0.35, "range sd {}", settled.range_sd);
    assert!((settled.mean_range - ORBIT_RADIUS).abs() < 1.0);
}

#[test]
fn orbiter_tightens_the_ring_is_a_spiral_not_a_fence() {
    let short = run(
        MovementKind::Orbiter,
        RunOpts {
            dist: ORBIT_RADIUS,
            frames: 300,
            ..Default::default()
        },
    );
    let long = run(
        MovementKind::Orbiter,
        RunOpts {
            dist: ORBIT_RADIUS,
            frames: 1200,
            ..Default::default()
        },
    );
    assert!(
        long.closest < short.closest - 0.5,
        "long {} vs short {}",
        long.closest,
        short.closest
    );
}

#[test]
fn leapers_pounce_is_an_arc() {
    let base = run(
        MovementKind::Chase,
        RunOpts {
            dist: 5.0,
            frames: 600,
            ..Default::default()
        },
    );
    let leap = run(
        MovementKind::Leaper,
        RunOpts {
            dist: 5.0,
            frames: 600,
            ..Default::default()
        },
    );
    assert!(base.curvature < 0.05, "chase curvature {}", base.curvature);
    assert!(leap.curvature > 0.15, "leap curvature {}", leap.curvature);
    assert!((leap.peak_mult - LEAP_SPEED_MULT).abs() < 1e-5);
}

/// Frame-by-frame: a run of frames with zero displacement, followed by the
/// fastest frames of the run. That shape IS the telegraph.
#[test]
fn leaper_crouches_first_there_is_a_window_where_it_is_stopped() {
    let mut a = MoveActor {
        x: 4.0,
        z: 0.0,
        speed: 2.0,
        move_phase: 0.9,
        ..Default::default()
    };
    let mut stillest = 0usize;
    let mut still_run = 0usize;
    let mut saw_burst = false;
    for _ in 0..300 {
        let pdist = a.x.hypot(a.z);
        let c = MoveCtx {
            dt: DT,
            pdx: -a.x,
            pdz: -a.z,
            pdist,
            flow_x: -a.x / pdist,
            flow_z: -a.z / pdist,
            contact_range: 0.7,
            los: true,
            pack_near: 1,
            pack_committed: false,
        };
        let s = steer(MovementKind::Leaper, &mut a, &c);
        if s.hold {
            still_run += 1;
            stillest = stillest.max(still_run);
        } else {
            if stillest > 0 && s.mult > 3.0 {
                saw_burst = true;
            }
            still_run = 0;
            a.x += s.vx * a.speed * s.mult * DT;
            a.z += s.vz * a.speed * s.mult * DT;
        }
    }
    assert!(
        stillest as f64 * DT > LEAP_WINDUP * 0.8,
        "crouch window {} s, want > {}",
        stillest as f64 * DT,
        LEAP_WINDUP * 0.8
    );
    assert!(saw_burst, "the crouch must be followed by the pounce");
}

#[test]
fn pack_hunter_will_not_engage_alone_and_rushes_at_quorum() {
    let alone = run(
        MovementKind::PackHunter,
        RunOpts {
            dist: 9.0,
            frames: 900,
            pack_near: Some(1),
            ..Default::default()
        },
    );
    let quorum = run(
        MovementKind::PackHunter,
        RunOpts {
            dist: 9.0,
            frames: 900,
            pack_near: Some(PACK_MIN as i32),
            ..Default::default()
        },
    );
    assert!(
        alone.closest > PACK_HOLD_RANGE - 0.5,
        "alone closest {}",
        alone.closest
    );
    assert!(quorum.closest < 1.0, "quorum closest {}", quorum.closest);
    assert!((quorum.peak_mult - PACK_RUSH_MULT).abs() < 1e-5);
}

/// The surge is a DECISION, not a flicker: once committed it stays committed
/// even if the pack dies around it.
#[test]
fn pack_hunter_commits_for_good_once_it_goes() {
    let mut a = MoveActor {
        x: 6.0,
        z: 0.0,
        speed: 2.0,
        move_phase: 0.5,
        ..Default::default()
    };
    let mk = |a: &MoveActor, near: i32| MoveCtx {
        dt: DT,
        pdx: -a.x,
        pdz: -a.z,
        pdist: a.x.hypot(a.z),
        flow_x: -1.0,
        flow_z: 0.0,
        contact_range: 0.7,
        los: true,
        pack_near: near,
        pack_committed: false,
    };
    let c = mk(&a, PACK_MIN as i32);
    steer(MovementKind::PackHunter, &mut a, &c); // quorum lands
    assert!(a.move_commit > 0.0, "it should have committed");
    let c2 = mk(&a, 1);
    let after = steer(MovementKind::PackHunter, &mut a, &c2); // pack dies around it
    assert!(
        (after.mult - PACK_RUSH_MULT).abs() < 1e-5,
        "still committed: mult {}",
        after.mult
    );
}

/// THE BLANKET ASSERTION — the one that would have caught "shipped the
/// mechanism, not the capability". A policy matching chase on every measured
/// quantity would be a label.
#[test]
fn every_policy_differs_from_chase_on_at_least_one_measured_axis() {
    let base = run(
        MovementKind::Chase,
        RunOpts {
            dist: 8.0,
            frames: 600,
            ..Default::default()
        },
    );
    // THE SIX WAVE-5 POLICIES, which is the oracle's own scope for this
    // assertion — and the scope is the interesting part.
    //
    // `rooted`, `phase` and `inert` are NOT in it, and must not be: they are
    // baseline intents extracted verbatim from the old cascade and they are
    // SUPPOSED to share chase's line. `rooted` literally returns
    // `{...chase(), rooted: true}` — the difference is a flag the caller reads
    // to multiply the step by zero, which a path measured in an open room
    // cannot see. Widening this loop to all eleven kinds fails on `rooted`
    // measuring 0.000 against chase's 0.000 on every axis, which is the port
    // being correct, not the port being a label. (It did, on the first run.)
    for k in [
        MovementKind::Flanker,
        MovementKind::Strafer,
        MovementKind::Ambusher,
        MovementKind::Orbiter,
        MovementKind::Leaper,
        MovementKind::PackHunter,
    ] {
        let r = run(
            k,
            RunOpts {
                dist: 8.0,
                frames: 600,
                ..Default::default()
            },
        );
        let differs = (r.off_axis - base.off_axis).abs() > 0.05
            || (r.mean_range - base.mean_range).abs() > 0.5
            || (r.curvature - base.curvature).abs() > 0.05
            || (r.tangential - base.tangential).abs() > 0.05
            || (r.closest - base.closest).abs() > 0.5
            || (r.peak_mult - base.peak_mult).abs() > 0.05
            || (r.displaced - base.displaced).abs() > 0.5;
        assert!(
            differs,
            "{k:?} measures identical to chase on every axis — that is a label, \
             not a behaviour (off_axis {:.3}/{:.3}, range {:.3}/{:.3}, curv \
             {:.3}/{:.3}, tan {:.3}/{:.3}, closest {:.3}/{:.3}, peak {:.3}/{:.3})",
            r.off_axis,
            base.off_axis,
            r.mean_range,
            base.mean_range,
            r.curvature,
            base.curvature,
            r.tangential,
            base.tangential,
            r.closest,
            base.closest,
            r.peak_mult,
            base.peak_mult
        );
    }
}

/// `is_committed` covers the POUNCE and deliberately not the crouch: walking
/// into a crouching leaper should get you bitten.
#[test]
fn only_the_pounce_is_uninterruptible() {
    let mut a = MoveActor {
        move_commit: 0.5,
        ..Default::default()
    };
    assert!(is_committed(MovementKind::Leaper, &a));
    a.move_commit = 1.5; // crouching
    assert!(!is_committed(MovementKind::Leaper, &a));
    a.move_commit = 0.5;
    assert!(!is_committed(MovementKind::Chase, &a), "only the leaper");
    cancel_commit(&mut a);
    assert!(!is_committed(MovementKind::Leaper, &a));
}

#[test]
fn only_the_policies_that_need_them_pay_for_the_probes() {
    assert!(needs_los(MovementKind::Ambusher));
    assert!(needs_los(MovementKind::Leaper));
    assert!(!needs_los(MovementKind::Chase));
    assert!(needs_pack(MovementKind::PackHunter));
    assert!(!needs_pack(MovementKind::Chase));
}
