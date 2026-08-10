//! ROULETTE — "The Orbit Wheel". Port of
//! `legacy/src/scenes/tavern/gambler/roulette.ts`.
//!
//! 19 pockets (0 plus 1–18) — DERIVED, not picked: every fairly-priced bet on
//! a single-zero N-pocket wheel returns N/(N+1), and 18 numbered pockets lands
//! on the same 5.26% house edge a real single-zero table has while staying
//! legible as a ring of chunky pixels. Every bet type carries the SAME edge:
//! the choice is about variance, not value.

/// Numbered pockets, not counting the zero.
pub const WHEEL_NUMBERS: i32 = 18;

/// Total pockets including 0.
pub const POCKETS: i32 = WHEEL_NUMBERS + 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PocketColor {
    Red,
    Black,
    Green,
}

/// Colour of a pocket — odd red / even black, zero green. A real wheel's
/// irregular assignment is invisible at 19 pockets and reads as a mistake.
pub fn color_of(n: i32) -> PocketColor {
    if n == 0 {
        return PocketColor::Green;
    }
    if n % 2 == 1 {
        PocketColor::Red
    } else {
        PocketColor::Black
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BetKind {
    Straight { n: i32 },
    Color { red: bool },
    Parity { odd: bool },
    Half { high: bool },
    Third { index: u8 },
}

#[derive(Debug, Clone)]
pub struct BetDef {
    pub id: &'static str,
    pub label: String,
    pub bet: BetKind,
    /// Total return multiplier on a win, stake INCLUDED.
    pub pays: f64,
}

/// Numbers covered by a third: 1–6, 7–12, 13–18.
pub fn third_range(index: u8) -> (i32, i32) {
    let lo = i32::from(index) * 6 + 1;
    (lo, lo + 5)
}

/// Does `n` win this bet? Zero loses everything except a straight-up on 0.
pub fn wins(bet: BetKind, n: i32) -> bool {
    match bet {
        BetKind::Straight { n: target } => n == target,
        BetKind::Color { red } => {
            color_of(n)
                == if red {
                    PocketColor::Red
                } else {
                    PocketColor::Black
                }
        }
        BetKind::Parity { odd } => {
            // Zero is neither odd nor even for betting purposes — that IS the edge.
            n != 0 && (n % 2 == 1) == odd
        }
        BetKind::Half { high } => {
            if n == 0 {
                return false;
            }
            if high {
                n > WHEEL_NUMBERS / 2
            } else {
                n <= WHEEL_NUMBERS / 2
            }
        }
        BetKind::Third { index } => {
            if n == 0 {
                return false;
            }
            let (lo, hi) = third_range(index);
            n >= lo && n <= hi
        }
    }
}

/// The bets on offer. `pays` is the TOTAL return including the stake.
pub fn bets() -> Vec<BetDef> {
    vec![
        BetDef {
            id: "red",
            label: "RED".into(),
            bet: BetKind::Color { red: true },
            pays: 2.0,
        },
        BetDef {
            id: "black",
            label: "BLACK".into(),
            bet: BetKind::Color { red: false },
            pays: 2.0,
        },
        BetDef {
            id: "odd",
            label: "ODD".into(),
            bet: BetKind::Parity { odd: true },
            pays: 2.0,
        },
        BetDef {
            id: "even",
            label: "EVEN".into(),
            bet: BetKind::Parity { odd: false },
            pays: 2.0,
        },
        BetDef {
            id: "low",
            label: "1-9".into(),
            bet: BetKind::Half { high: false },
            pays: 2.0,
        },
        BetDef {
            id: "high",
            label: "10-18".into(),
            bet: BetKind::Half { high: true },
            pays: 2.0,
        },
        BetDef {
            id: "t1",
            label: "1-6".into(),
            bet: BetKind::Third { index: 0 },
            pays: 3.0,
        },
        BetDef {
            id: "t2",
            label: "7-12".into(),
            bet: BetKind::Third { index: 1 },
            pays: 3.0,
        },
        BetDef {
            id: "t3",
            label: "13-18".into(),
            bet: BetKind::Third { index: 2 },
            pays: 3.0,
        },
    ]
}

/// A straight-up bet on one number. NOT in `bets()` — the cabinet's fixed 3×3
/// chip grid has no room for nineteen more buttons — but priced correctly
/// (18× on a 19-pocket wheel) and pinned by the pricing tests so it can't rot.
pub fn straight_bet(n: i32) -> BetDef {
    BetDef {
        id: "straight",
        label: n.to_string(),
        bet: BetKind::Straight { n },
        pays: f64::from(POCKETS - 1),
    }
}

/// Spin the wheel.
pub fn spin_wheel(rand: &mut dyn FnMut() -> f64) -> i32 {
    (rand() * f64::from(POCKETS)).floor() as i32
}

/// Settle a bet against a result. Returns the stake multiplier (0 = lost).
pub fn settle_bet(bet: &BetDef, pocket: i32) -> (f64, String) {
    let won = wins(bet.bet, pocket);
    let col = match color_of(pocket) {
        PocketColor::Red => "RED",
        PocketColor::Black => "BLACK",
        PocketColor::Green => "GREEN",
    };
    let where_ = if pocket == 0 {
        "ZERO".to_string()
    } else {
        format!("{pocket} {col}")
    };
    if won {
        (bet.pays, format!("{where_} — {} WINS", bet.label))
    } else {
        (0.0, format!("{where_} — {} LOSES", bet.label))
    }
}

/// Exact RTP of a bet by enumerating every pocket. Every bet should come out
/// at 18/19 ≈ 0.9474; any that doesn't is mispriced.
pub fn exact_rtp(bet: &BetDef) -> f64 {
    let mut total = 0.0;
    for n in 0..POCKETS {
        total += settle_bet(bet, n).0;
    }
    total / f64::from(POCKETS)
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/gambler/roulette.test.ts`
    //! (pricing/wheel/coverage half; the physics half lives with
    //! `roulette_physics.rs`).
    use super::*;
    use crate::rng::Mulberry32;

    const EXPECTED_RTP: f64 = WHEEL_NUMBERS as f64 / POCKETS as f64; // 18/19

    #[test]
    fn every_table_bet_returns_exactly_18_19ths() {
        for b in bets() {
            assert!(
                (exact_rtp(&b) - EXPECTED_RTP).abs() < 1e-10,
                "{:?} is mispriced",
                b.label
            );
        }
    }

    #[test]
    fn a_straight_up_on_any_number_returns_18_19ths_too() {
        for n in 0..POCKETS {
            assert!(
                (exact_rtp(&straight_bet(n)) - EXPECTED_RTP).abs() < 1e-10,
                "straight {n} is mispriced"
            );
        }
    }

    #[test]
    fn no_bet_ever_returns_100_percent_or_more() {
        for b in bets() {
            assert!(exact_rtp(&b) < 1.0);
        }
        for n in 0..POCKETS {
            assert!(exact_rtp(&straight_bet(n)) < 1.0);
        }
    }

    #[test]
    fn lands_on_the_real_single_zero_house_edge() {
        assert!(((1.0 - EXPECTED_RTP) * 100.0 - 5.26).abs() < 0.05);
    }

    #[test]
    fn has_19_pockets_zero_plus_1_to_18() {
        assert_eq!(POCKETS, 19);
    }

    #[test]
    fn colours_zero_green_and_alternates_the_rest() {
        assert_eq!(color_of(0), PocketColor::Green);
        assert_eq!(color_of(1), PocketColor::Red);
        assert_eq!(color_of(2), PocketColor::Black);
        assert_eq!(color_of(17), PocketColor::Red);
        assert_eq!(color_of(18), PocketColor::Black);
    }

    #[test]
    fn splits_red_and_black_evenly() {
        let mut red = 0;
        let mut black = 0;
        for n in 1..=WHEEL_NUMBERS {
            if color_of(n) == PocketColor::Red {
                red += 1;
            } else {
                black += 1;
            }
        }
        assert_eq!(red, black);
    }

    #[test]
    fn only_ever_produces_a_real_pocket() {
        let mut rng = Mulberry32::new(7);
        let mut rand = move || rng.next_f64();
        for _ in 0..5000 {
            let n = spin_wheel(&mut rand);
            assert!((0..POCKETS).contains(&n));
        }
    }

    #[test]
    fn zero_loses_every_even_money_bet() {
        assert!(!wins(BetKind::Color { red: true }, 0));
        assert!(!wins(BetKind::Color { red: false }, 0));
        assert!(!wins(BetKind::Parity { odd: true }, 0));
        // Zero is EVEN as an integer — treating it as such would wipe out the
        // entire house edge.
        assert!(!wins(BetKind::Parity { odd: false }, 0));
        assert!(!wins(BetKind::Half { high: false }, 0));
        assert!(!wins(BetKind::Third { index: 0 }, 0));
    }

    #[test]
    fn zero_still_pays_a_straight_up_bet_on_zero() {
        assert!(wins(BetKind::Straight { n: 0 }, 0));
    }

    #[test]
    fn halves_split_the_numbers_evenly_and_dont_overlap() {
        let mut low = 0;
        let mut high = 0;
        for n in 1..=WHEEL_NUMBERS {
            let l = wins(BetKind::Half { high: false }, n);
            let h = wins(BetKind::Half { high: true }, n);
            assert!(!(l && h), "{n} is in both halves");
            assert!(l || h, "{n} is in neither half");
            if l {
                low += 1;
            } else {
                high += 1;
            }
        }
        assert_eq!(low, high);
    }

    #[test]
    fn thirds_tile_the_wheel_exactly_once_each() {
        for n in 1..=WHEEL_NUMBERS {
            let hits = [0u8, 1, 2]
                .iter()
                .filter(|i| wins(BetKind::Third { index: **i }, n))
                .count();
            assert_eq!(hits, 1, "{n} is covered by {hits} thirds");
        }
    }

    #[test]
    fn thirds_cover_1_6_7_12_13_18() {
        assert_eq!(third_range(0), (1, 6));
        assert_eq!(third_range(1), (7, 12));
        assert_eq!(third_range(2), (13, 18));
    }

    #[test]
    fn settle_names_the_pocket_and_the_bet_in_the_result() {
        let red = bets().into_iter().find(|b| b.id == "red").unwrap();
        let (m, label) = settle_bet(&red, 1);
        assert_eq!(m, 2.0);
        assert!(label.contains('1'));
        assert!(label.contains("RED"));
    }

    #[test]
    fn settle_calls_a_zero_out_by_name() {
        assert!(settle_bet(&bets()[0], 0).1.contains("ZERO"));
    }

    #[test]
    fn settle_pays_a_straight_up_18x_stake_included() {
        assert_eq!(settle_bet(&straight_bet(7), 7).0, 18.0);
    }
}
