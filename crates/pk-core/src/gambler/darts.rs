//! DARTS — "The Board". Port of `legacy/src/scenes/tavern/gambler/darts.ts`.
//!
//! The one game decided by execution rather than odds: 12 wedges (20 are
//! unreadable at pixel scale), standard rings, and a BOUNDED wobble that
//! scales with the stake and the dart number — the whole risk/reward axis.
//! The payout bands are FITTED to a measured perfect-timing RTP in
//! [1.05, 1.35] (about one floor's income per visit for a master).
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/darts.ts`

use super::table::{MAX_STAKE_ABS, MIN_STAKE};
use crate::jsmath::js_hypot;

/// Wedge values clockwise from the top. Ordered so neighbours differ wildly —
/// that adjacency is what punishes a near miss on a real board.
pub const WEDGES: [i32; 12] = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19];

pub const WEDGE_COUNT: usize = WEDGES.len();

/// Ring radii as a fraction of the board radius, outermost first.
pub const R_OUTER: f64 = 1.0; // beyond this = miss
pub const R_DOUBLE_IN: f64 = 0.88; // double ring: 0.88 .. 1.0
pub const R_TREBLE_OUT: f64 = 0.58;
pub const R_TREBLE_IN: f64 = 0.48; // treble ring: 0.48 .. 0.58
pub const R_OUTER_BULL: f64 = 0.14;
pub const R_BULL: f64 = 0.06;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HitRing {
    Miss,
    Single,
    Double,
    Treble,
    OuterBull,
    Bull,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub ring: HitRing,
    /// Wedge value, or 0 for the bulls and a miss.
    pub wedge: i32,
    pub points: i32,
    pub label: String,
}

/// Score a throw. `x`/`y` are offsets from the board centre in units of the
/// board RADIUS, so (0,0) is the bullseye.
pub fn score_at(x: f64, y: f64) -> Hit {
    let r = js_hypot(x, y);

    if r > R_OUTER {
        return Hit {
            ring: HitRing::Miss,
            wedge: 0,
            points: 0,
            label: "MISS".into(),
        };
    }
    if r <= R_BULL {
        return Hit {
            ring: HitRing::Bull,
            wedge: 0,
            points: 50,
            label: "BULLSEYE".into(),
        };
    }
    if r <= R_OUTER_BULL {
        return Hit {
            ring: HitRing::OuterBull,
            wedge: 0,
            points: 25,
            label: "OUTER BULL".into(),
        };
    }

    // Wedge index, measured clockwise from straight up.
    let ang = libm::atan2(x, -y); // 0 = up, +ve clockwise
    let norm = (ang + std::f64::consts::PI * 2.0) % (std::f64::consts::PI * 2.0);
    let idx = (libm::floor(norm / (std::f64::consts::PI * 2.0) * WEDGE_COUNT as f64 + 0.5)
        as usize)
        % WEDGE_COUNT;
    let wedge = WEDGES[idx];

    if r >= R_DOUBLE_IN {
        return Hit {
            ring: HitRing::Double,
            wedge,
            points: wedge * 2,
            label: format!("DOUBLE {wedge}"),
        };
    }
    if (R_TREBLE_IN..=R_TREBLE_OUT).contains(&r) {
        return Hit {
            ring: HitRing::Treble,
            wedge,
            points: wedge * 3,
            label: format!("TREBLE {wedge}"),
        };
    }
    Hit {
        ring: HitRing::Single,
        wedge,
        points: wedge,
        label: wedge.to_string(),
    }
}

/// Darts thrown per round.
pub const DARTS_PER_ROUND: usize = 3;

/// Payout for a three-dart total, as a stake multiplier (stake included).
/// Derived from the visit limit, not eyeballed — see the legacy header for
/// the measured economics.
pub struct PayoutBand {
    pub min: i32,
    pub mult: f64,
    pub label: &'static str,
}

pub const PAYOUT_BANDS: [PayoutBand; 5] = [
    PayoutBand {
        min: 155,
        mult: 2.0,
        label: "MASTERFUL",
    },
    PayoutBand {
        min: 120,
        mult: 1.55,
        label: "EXCELLENT",
    },
    PayoutBand {
        min: 90,
        mult: 1.2,
        label: "STRONG",
    },
    PayoutBand {
        min: 55,
        mult: 1.0,
        label: "PUSH",
    },
    PayoutBand {
        min: 0,
        mult: 0.0,
        label: "POOR",
    },
];

pub fn payout_for(total: i32) -> (f64, &'static str) {
    for band in &PAYOUT_BANDS {
        if total >= band.min {
            return (band.mult, band.label);
        }
    }
    (0.0, "POOR")
}

/// The sweep speed for a stake, in sweeps per second — the bigger the bet,
/// the faster the bar, so risk is felt in the hands.
pub fn sweep_speed(stake: f64) -> f64 {
    // 5g -> ~0.85/s, 100g -> ~2.0/s. Log-ish so the low end stays learnable.
    0.8 + libm::log10(stake.max(1.0)) * 0.6
}

/// How much faster the sweep runs on dart `i` of the round (0-based). The
/// third dart decides the band, so it is the fastest.
pub fn dart_speed_ramp(i: usize) -> f64 {
    1.0 + 0.22 * i as f64
}

/// Sweep speed actually used for dart `i` of a round at this stake.
pub fn throw_speed(stake: f64, dart_index: usize) -> f64 {
    sweep_speed(stake) * dart_speed_ramp(dart_index)
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// Scatter radius on the first dart of a MIN_STAKE round — tight, learnable.
pub const WOBBLE_AT_MIN_STAKE: f64 = 0.025;
/// Scatter radius on the first dart of a MAX_STAKE_ABS round — genuinely shaky.
pub const WOBBLE_AT_MAX_STAKE: f64 = 0.12;

/// The radius of the disc a throw scatters into — the unsteady hand.
/// HARD BOUND, not a sigma; interpolated between the stake limits in LOG
/// space so the curve stays anchored to `table.rs`.
pub fn wobble_radius(stake: f64, dart_index: usize) -> f64 {
    let lo = libm::log10(MIN_STAKE as f64);
    let hi = libm::log10(MAX_STAKE_ABS as f64);
    let t = clamp((libm::log10(stake.max(1.0)) - lo) / (hi - lo), 0.0, 1.0);
    let base = WOBBLE_AT_MIN_STAKE + t * (WOBBLE_AT_MAX_STAKE - WOBBLE_AT_MIN_STAKE);
    base * (1.0 + 0.25 * dart_index as f64)
}

/// Apply the wobble to a locked aim point. Uniform over the disc (radius ∝
/// √u, or throws would bunch at the centre). `rng` injected for determinism.
pub fn apply_wobble(x: f64, y: f64, radius: f64, rng: &mut dyn FnMut() -> f64) -> (f64, f64) {
    let ang = rng() * std::f64::consts::PI * 2.0;
    let r = clamp(rng(), 0.0, 1.0).sqrt() * radius;
    (x + libm::cos(ang) * r, y + libm::sin(ang) * r)
}

/// How far the Y sweep travels once X is locked, as a half-range — the CHORD
/// of the board at that X (slightly overshot), so every X lock stays playable
/// and the rim is self-balancing.
pub fn y_half_range(x: f64) -> f64 {
    let chord = (1.0 - x * x).max(0.0).sqrt();
    (chord * 1.08 + 0.04).max(0.16)
}

/// How far past the rim the X sweep travels — a bad lock can miss.
pub const X_SWEEP_AMPLITUDE: f64 = 1.06;

/// Highest achievable three-dart score, for sanity-checking the bands.
pub fn max_round() -> i32 {
    WEDGES.iter().copied().max().unwrap() * 3 * DARTS_PER_ROUND as i32
}

/// The point a good player aims at: the centre of the treble-20 band.
pub const TREBLE_20: (f64, f64) = (0.0, -(R_TREBLE_IN + R_TREBLE_OUT) / 2.0);

/// The point a cautious player aims at: the fat single-20, a huge target.
pub const SAFE_20: (f64, f64) = (0.0, -(R_OUTER_BULL + R_TREBLE_IN) / 2.0);

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/gambler/darts.test.ts`
    //! (board/bands/sweep/wobble + the economy Monte-Carlos; the throw state
    //! machine's cases live with `darts_throw.rs`).
    use super::*;
    use crate::gambler::table::ROUNDS_PER_VISIT;
    use crate::rng::Mulberry32;

    /// A point at radius r along the centre of wedge index i.
    fn at_wedge(i: usize, r: f64) -> (f64, f64) {
        let ang = (i as f64 / WEDGE_COUNT as f64) * std::f64::consts::PI * 2.0;
        (libm::sin(ang) * r, -libm::cos(ang) * r)
    }

    fn seeded(seed: u32) -> impl FnMut() -> f64 {
        let mut rng = Mulberry32::new(seed);
        move || rng.next_f64()
    }

    #[test]
    fn dead_centre_is_a_bullseye_worth_50() {
        let h = score_at(0.0, 0.0);
        assert_eq!(h.ring, HitRing::Bull);
        assert_eq!(h.points, 50);
    }

    #[test]
    fn just_outside_the_bull_is_the_outer_bull_worth_25() {
        let h = score_at(0.0, -(R_BULL + 0.01));
        assert_eq!(h.ring, HitRing::OuterBull);
        assert_eq!(h.points, 25);
    }

    #[test]
    fn the_bull_beats_the_outer_bull() {
        assert!(score_at(0.0, 0.0).points > score_at(0.0, -(R_BULL + 0.01)).points);
    }

    #[test]
    fn bulls_belong_to_no_wedge() {
        assert_eq!(score_at(0.0, 0.0).wedge, 0);
    }

    #[test]
    fn scores_a_single_between_the_bull_and_the_treble() {
        let p = at_wedge(0, (R_OUTER_BULL + R_TREBLE_IN) / 2.0);
        let h = score_at(p.0, p.1);
        assert_eq!(h.ring, HitRing::Single);
        assert_eq!(h.points, WEDGES[0]);
    }

    #[test]
    fn trebles_the_middle_band() {
        let p = at_wedge(0, (R_TREBLE_IN + R_TREBLE_OUT) / 2.0);
        let h = score_at(p.0, p.1);
        assert_eq!(h.ring, HitRing::Treble);
        assert_eq!(h.points, WEDGES[0] * 3);
    }

    #[test]
    fn doubles_the_outer_band() {
        let p = at_wedge(0, (R_DOUBLE_IN + 1.0) / 2.0);
        let h = score_at(p.0, p.1);
        assert_eq!(h.ring, HitRing::Double);
        assert_eq!(h.points, WEDGES[0] * 2);
    }

    #[test]
    fn scores_a_single_between_the_treble_and_the_double() {
        let p = at_wedge(0, (R_TREBLE_OUT + R_DOUBLE_IN) / 2.0);
        assert_eq!(score_at(p.0, p.1).ring, HitRing::Single);
    }

    #[test]
    fn misses_beyond_the_board() {
        let h = score_at(0.0, -1.4);
        assert_eq!(h.ring, HitRing::Miss);
        assert_eq!(h.points, 0);
    }

    #[test]
    fn a_near_miss_just_off_the_edge_scores_nothing() {
        assert_eq!(score_at(0.0, -1.001).points, 0);
    }

    #[test]
    fn puts_wedge_0_straight_up() {
        assert_eq!(score_at(0.0, -0.7).wedge, WEDGES[0]);
    }

    #[test]
    fn walks_clockwise() {
        let p = at_wedge(1, 0.7);
        assert_eq!(score_at(p.0, p.1).wedge, WEDGES[1]);
    }

    #[test]
    fn covers_every_wedge_exactly_once_around_the_board() {
        let mut seen = std::collections::HashSet::new();
        for i in 0..WEDGE_COUNT {
            let p = at_wedge(i, 0.7);
            seen.insert(score_at(p.0, p.1).wedge);
        }
        assert_eq!(seen.len(), WEDGE_COUNT);
    }

    #[test]
    fn wraps_cleanly_at_the_top_rather_than_leaving_a_dead_slice() {
        let eps = 0.02;
        assert!(score_at(-eps, -0.7).wedge > 0);
        assert!(score_at(eps, -0.7).wedge > 0);
    }

    #[test]
    fn gives_wildly_different_values_to_neighbours() {
        let mut big_jumps = 0;
        for i in 0..WEDGE_COUNT {
            let a = WEDGES[i];
            let b = WEDGES[(i + 1) % WEDGE_COUNT];
            if (a - b).abs() >= 5 {
                big_jumps += 1;
            }
        }
        assert!(big_jumps > WEDGE_COUNT / 2);
    }

    #[test]
    fn pays_nothing_for_a_poor_round() {
        assert_eq!(payout_for(0).0, 0.0);
        assert_eq!(payout_for(29).0, 0.0);
    }

    #[test]
    fn pushes_exactly_at_the_safe_line_three_fat_20s() {
        assert_eq!(payout_for(60).0, 1.0);
        assert_eq!(payout_for(54).0, 0.0);
    }

    #[test]
    fn rises_with_the_score_and_never_falls() {
        let mut prev = -1.0;
        let mut total = 0;
        while total <= max_round() {
            let m = payout_for(total).0;
            assert!(m >= prev, "payout dipped at {total}");
            prev = prev.max(m);
            total += 5;
        }
    }

    #[test]
    fn three_singles_is_a_loss_the_floor_has_to_hurt() {
        assert_eq!(payout_for(3 * 6).0, 0.0);
    }

    #[test]
    fn caps_below_the_theoretical_maximum_being_trivially_reachable() {
        assert_eq!(max_round(), 180);
        assert!(f64::from(PAYOUT_BANDS[0].min) > f64::from(max_round()) * 0.6);
    }

    #[test]
    fn sweep_rises_with_the_stake() {
        assert!(sweep_speed(100.0) > sweep_speed(5.0));
    }

    #[test]
    fn sweep_stays_playable_at_the_smallest_stake() {
        assert!(sweep_speed(5.0) < 1.5);
    }

    #[test]
    fn sweep_stays_possible_at_the_largest() {
        assert!(sweep_speed(100.0) < 3.0);
    }

    #[test]
    fn throws_three_darts() {
        assert_eq!(DARTS_PER_ROUND, 3);
    }

    #[test]
    fn y_sweep_gives_the_full_height_at_the_centre() {
        assert!(y_half_range(0.0) > 1.0);
    }

    #[test]
    fn y_sweep_narrows_as_the_aim_moves_out_toward_the_rim() {
        assert!(y_half_range(0.9) < y_half_range(0.5));
        assert!(y_half_range(0.5) < y_half_range(0.0));
    }

    #[test]
    fn y_sweep_keeps_every_x_lock_playable_the_window_is_never_zero() {
        let mut x = -X_SWEEP_AMPLITUDE;
        while x <= X_SWEEP_AMPLITUDE {
            assert!(y_half_range(x) > 0.1, "dead window at x={x:.2}");
            x += 0.02;
        }
    }

    #[test]
    fn y_sweep_still_lets_a_centred_aim_overshoot_the_board_and_miss() {
        assert!(y_half_range(0.0) > R_OUTER);
    }

    #[test]
    fn y_sweep_covers_the_boards_actual_chord_wherever_you_lock() {
        for x in [0.0, 0.3, 0.6, 0.85] {
            assert!(y_half_range(x) >= (1.0 - x * x).sqrt());
        }
    }

    #[test]
    fn wobble_is_tighter_than_the_treble_band_at_the_minimum_stake() {
        let treble_half_width = (R_TREBLE_OUT - R_TREBLE_IN) / 2.0;
        assert!(wobble_radius(MIN_STAKE as f64, 0) < treble_half_width);
    }

    #[test]
    fn wobble_is_wider_than_the_treble_band_at_the_maximum_stake() {
        let treble_half_width = (R_TREBLE_OUT - R_TREBLE_IN) / 2.0;
        assert!(wobble_radius(MAX_STAKE_ABS as f64, 0) > treble_half_width);
    }

    #[test]
    fn leaves_the_fat_single_ring_far_more_forgiving_than_the_treble_band() {
        let fat_ring_half_width = (R_TREBLE_IN - R_OUTER_BULL) / 2.0;
        let treble_half_width = (R_TREBLE_OUT - R_TREBLE_IN) / 2.0;
        assert!(fat_ring_half_width / treble_half_width > 3.0);
    }

    #[test]
    fn outgrows_even_the_fat_ring_by_the_last_dart_of_a_max_stake_round() {
        let fat_ring_half_width = (R_TREBLE_IN - R_OUTER_BULL) / 2.0;
        assert!(wobble_radius(MIN_STAKE as f64, 0) < fat_ring_half_width);
        assert!(wobble_radius(MAX_STAKE_ABS as f64, DARTS_PER_ROUND - 1) > fat_ring_half_width);
    }

    #[test]
    fn wobble_grows_with_the_stake_and_with_the_dart_number() {
        assert!(wobble_radius(100.0, 0) > wobble_radius(5.0, 0));
        assert!(wobble_radius(50.0, 2) > wobble_radius(50.0, 0));
    }

    #[test]
    fn wobble_is_a_hard_bound_so_a_dart_never_lands_somewhere_absurd() {
        let r = wobble_radius(100.0, 2);
        let mut rand = seeded(4242);
        for _ in 0..2000 {
            let p = apply_wobble(0.2, -0.4, r, &mut rand);
            assert!(js_hypot(p.0 - 0.2, p.1 + 0.4) <= r + 1e-9);
        }
    }

    #[test]
    fn wobble_scatters_in_every_direction_rather_than_favouring_one() {
        let mut left = 0;
        let mut up = 0;
        const N: usize = 4000;
        let mut rand = seeded(808);
        for _ in 0..N {
            let p = apply_wobble(0.0, 0.0, 0.1, &mut rand);
            if p.0 < 0.0 {
                left += 1;
            }
            if p.1 < 0.0 {
                up += 1;
            }
        }
        let lf = left as f64 / N as f64;
        let uf = up as f64 / N as f64;
        assert!(lf > 0.44 && lf < 0.56, "left fraction {lf}");
        assert!(uf > 0.44 && uf < 0.56, "up fraction {uf}");
    }

    #[test]
    fn speeds_up_on_each_successive_dart() {
        assert!(dart_speed_ramp(1) > dart_speed_ramp(0));
        assert!(dart_speed_ramp(2) > dart_speed_ramp(1));
    }

    #[test]
    fn leaves_the_first_dart_at_the_plain_stake_speed() {
        assert!((throw_speed(25.0, 0) - sweep_speed(25.0)).abs() < 1e-10);
    }

    #[test]
    fn keeps_even_the_last_dart_of_a_max_stake_round_throwable() {
        assert!(throw_speed(100.0, DARTS_PER_ROUND - 1) < 3.5);
    }

    // ── The per-visit economics — the reason the file exists. ──

    /// An optimal player: locks dead on `aim`, and only the hand betrays them.
    fn simulate(
        aim: (f64, f64),
        stake: f64,
        jitter: f64,
        rounds: usize,
        rand: &mut dyn FnMut() -> f64,
    ) -> f64 {
        let mut returned = 0.0;
        for _ in 0..rounds {
            let mut total = 0;
            for i in 0..DARTS_PER_ROUND {
                let ax = aim.0 + (rand() * 2.0 - 1.0) * jitter;
                let ay = aim.1 + (rand() * 2.0 - 1.0) * jitter;
                let p = apply_wobble(ax, ay, wobble_radius(stake, i), rand);
                total += score_at(p.0, p.1).points;
            }
            returned += payout_for(total).0;
        }
        returned / rounds as f64
    }

    const N: usize = 40_000;

    #[test]
    fn caps_a_master_at_roughly_one_floors_income_per_visit() {
        let mut rand = seeded(1);
        let r = simulate(TREBLE_20, MAX_STAKE_ABS as f64, 0.0, N, &mut rand);
        assert!(r > 1.05, "perfect-timing RTP was {r:.3}");
        assert!(r < 1.35, "perfect-timing RTP was {r:.3}");

        let profit = ROUNDS_PER_VISIT as f64 * MAX_STAKE_ABS as f64 * (r - 1.0);
        assert!(profit > 30.0);
        assert!(profit < 230.0);
    }

    #[test]
    fn leaves_an_ordinary_player_at_about_break_even() {
        let mut rand = seeded(2);
        let r = simulate(TREBLE_20, MAX_STAKE_ABS as f64, 0.15, N, &mut rand);
        assert!(r > 0.85, "sloppy RTP was {r:.3}");
        assert!(r < 1.15, "sloppy RTP was {r:.3}");
    }

    #[test]
    fn makes_playing_safe_a_push_at_a_small_stake_and_a_loss_at_a_big_one() {
        let mut rand = seeded(3);
        let small = simulate(SAFE_20, MIN_STAKE as f64, 0.0, 4000, &mut rand);
        assert!(
            (small - 1.0).abs() < 0.005,
            "safe small-stake RTP was {small:.3}"
        );
        let big = simulate(SAFE_20, MAX_STAKE_ABS as f64, 0.0, N, &mut rand);
        assert!(big < 0.8, "safe max-stake RTP was {big:.3}");
    }

    #[test]
    fn still_pays_the_greedy_line_better_than_the_safe_one_at_every_stake() {
        let mut rand = seeded(4);
        for stake in [MIN_STAKE as f64, 25.0, MAX_STAKE_ABS as f64] {
            let greedy = simulate(TREBLE_20, stake, 0.0, 8000, &mut rand);
            let safe = simulate(SAFE_20, stake, 0.0, 8000, &mut rand);
            assert!(
                greedy > safe,
                "stake {stake}: greedy {greedy:.3} vs safe {safe:.3}"
            );
        }
    }

    #[test]
    fn pays_less_per_gold_staked_as_the_stake_rises_the_cap_is_self_enforcing() {
        let mut rand = seeded(5);
        let small = simulate(TREBLE_20, MIN_STAKE as f64, 0.0, 8000, &mut rand);
        let big = simulate(TREBLE_20, MAX_STAKE_ABS as f64, 0.0, 8000, &mut rand);
        assert!(big < small);
    }

    #[test]
    fn never_pays_more_than_the_old_curves_floor_at_any_reachable_total() {
        for b in &PAYOUT_BANDS {
            assert!(b.mult <= 2.0);
        }
        assert!(payout_for(max_round()).0 <= 2.0);
    }
}
