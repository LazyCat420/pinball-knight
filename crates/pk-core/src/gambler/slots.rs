//! SLOTS — "The One-Armed Bandit". Port of
//! `legacy/src/scenes/tavern/gambler/slots.ts`: weighted reel strip, target
//! RTP ~90%, pure and injectable-random so the tests Monte-Carlo the real
//! return instead of trusting the paytable arithmetic.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Symbol {
    Ball,
    Bumper,
    Flipper,
    Target,
    Jackpot,
    Skull,
}

impl Symbol {
    pub fn name(self) -> &'static str {
        match self {
            Symbol::Ball => "BALL",
            Symbol::Bumper => "BUMPER",
            Symbol::Flipper => "FLIPPER",
            Symbol::Target => "TARGET",
            Symbol::Jackpot => "JACKPOT",
            Symbol::Skull => "SKULL",
        }
    }
}

use Symbol::{Ball, Bumper, Flipper, Jackpot, Skull, Target};

/// The reel strip — one entry per stop position. All three reels share it.
/// The composition is SOLVED, not guessed (see the legacy header: the first
/// plausible-looking table enumerated to a 13% RTP). `jackpot` appears exactly
/// once, so P(★★★) ≈ 1/4096 — but it is visibly present on every reel.
pub const REEL_STRIP: [Symbol; 16] = [
    Skull, Ball, Bumper, Flipper, Ball, Bumper, Skull, Ball, Flipper, Bumper, Ball, Target,
    Flipper, Ball, Bumper, Jackpot,
];

/// Multiplier on the stake for three of a kind, stake included.
pub fn paytable(s: Symbol) -> f64 {
    match s {
        Jackpot => 25.0,
        Target => 14.0,
        Flipper => 10.0,
        Bumper => 6.0,
        Ball => 4.0,
        Skull => 0.0, // three skulls pays nothing — the joke, and part of the tax
    }
}

/// Two jackpots anywhere on the line — the consolation for a near miss.
pub const TWO_JACKPOT_PAY: f64 = 3.0;

/// Any two matching symbols pays this — carries roughly half the total RTP.
pub const ANY_PAIR_PAY: f64 = 1.2;

#[derive(Debug, Clone, PartialEq)]
pub struct SpinOutcome {
    pub reels: [Symbol; 3],
    /// Multiplier applied to the stake. 0 = lost, 1 = push.
    pub multiplier: f64,
    pub label: String,
}

/// Spin three reels off the strip.
pub fn spin(rand: &mut dyn FnMut() -> f64) -> SpinOutcome {
    let pick = |rand: &mut dyn FnMut() -> f64| -> Symbol {
        REEL_STRIP[(rand() * REEL_STRIP.len() as f64).floor() as usize]
    };
    let reels = [pick(rand), pick(rand), pick(rand)];
    let (multiplier, label) = score(reels);
    SpinOutcome {
        reels,
        multiplier,
        label,
    }
}

/// Score a line. Separated from `spin` so tests can score exact reel sets.
pub fn score(reels: [Symbol; 3]) -> (f64, String) {
    let [a, b, c] = reels;

    if a == b && b == c {
        let mult = paytable(a);
        if mult == 0.0 {
            return (0.0, "THREE SKULLS — NOTHING".into());
        }
        return (mult, format!("THREE {}S", a.name()));
    }

    // Two jackpots is the consolation that keeps a near miss from feeling empty.
    let jackpots = reels.iter().filter(|s| **s == Jackpot).count();
    if jackpots == 2 {
        return (TWO_JACKPOT_PAY, "TWO JACKPOTS".into());
    }

    // Any pair — small, frequent, and where most of the return actually lives.
    if a == b || b == c || a == c {
        let pair_sym = if a == b || a == c { a } else { b };
        return (ANY_PAIR_PAY, format!("PAIR OF {}S", pair_sym.name()));
    }

    (0.0, "NO LINE".into())
}

/// Exact RTP of the current strip and paytable, by full enumeration
/// (16³ = 4096 combinations).
pub fn exact_rtp() -> f64 {
    let n = REEL_STRIP.len();
    let mut total = 0.0;
    for i in 0..n {
        for j in 0..n {
            for k in 0..n {
                total += score([REEL_STRIP[i], REEL_STRIP[j], REEL_STRIP[k]]).0;
            }
        }
    }
    total / (n * n * n) as f64
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/gambler/slots.test.ts` (the
    //! symbol-art case stays with the legacy canvas painters).
    use super::*;
    use crate::rng::Mulberry32;

    #[test]
    fn pays_back_close_to_90_percent_by_full_enumeration() {
        let r = exact_rtp();
        assert!(r > 0.86);
        assert!(r < 0.94);
    }

    #[test]
    fn never_pays_over_100_percent_the_house_must_win_on_average() {
        assert!(exact_rtp() < 1.0);
    }

    #[test]
    fn a_monte_carlo_run_agrees_with_the_enumeration() {
        let mut rng = Mulberry32::new(12345);
        let mut rand = move || rng.next_f64();
        let mut staked = 0.0;
        let mut returned = 0.0;
        for _ in 0..200_000 {
            staked += 10.0;
            returned += spin(&mut rand).multiplier * 10.0;
        }
        assert!((returned / staked - exact_rtp()).abs() < 0.05);
    }

    #[test]
    fn pays_three_of_a_kind_by_the_paytable() {
        assert_eq!(score([Jackpot, Jackpot, Jackpot]).0, paytable(Jackpot));
        assert_eq!(score([Ball, Ball, Ball]).0, paytable(Ball));
    }

    #[test]
    fn three_skulls_pays_nothing() {
        let (m, label) = score([Skull, Skull, Skull]);
        assert_eq!(m, 0.0);
        assert!(label.contains("SKULL"));
    }

    #[test]
    fn two_jackpots_pays_the_consolation_in_any_position() {
        assert_eq!(score([Jackpot, Jackpot, Ball]).0, TWO_JACKPOT_PAY);
        assert_eq!(score([Jackpot, Ball, Jackpot]).0, TWO_JACKPOT_PAY);
        assert_eq!(score([Ball, Jackpot, Jackpot]).0, TWO_JACKPOT_PAY);
    }

    #[test]
    fn two_jackpots_beats_the_plain_any_pair_rate() {
        assert!(TWO_JACKPOT_PAY > ANY_PAIR_PAY);
    }

    #[test]
    fn pays_any_pair_in_any_position() {
        assert_eq!(score([Ball, Ball, Target]).0, ANY_PAIR_PAY);
        assert_eq!(score([Ball, Target, Ball]).0, ANY_PAIR_PAY);
        assert_eq!(score([Target, Ball, Ball]).0, ANY_PAIR_PAY);
    }

    #[test]
    fn names_the_symbol_that_actually_paired() {
        assert!(score([Target, Ball, Ball]).1.contains("BALL"));
        assert!(score([Ball, Target, Target]).1.contains("TARGET"));
    }

    #[test]
    fn pays_nothing_for_three_different_symbols() {
        assert_eq!(score([Ball, Bumper, Target]).0, 0.0);
    }

    #[test]
    fn a_skull_pair_still_pays_only_the_triple_is_worthless() {
        assert_eq!(score([Skull, Skull, Ball]).0, ANY_PAIR_PAY);
    }

    #[test]
    fn keeps_the_jackpot_to_exactly_one_stop() {
        assert_eq!(REEL_STRIP.iter().filter(|s| **s == Jackpot).count(), 1);
    }

    #[test]
    fn shows_the_jackpot_on_the_reel_rather_than_hiding_it() {
        assert!(REEL_STRIP.contains(&Jackpot));
    }

    #[test]
    fn has_every_symbol_the_paytable_prices() {
        for sym in [Ball, Bumper, Flipper, Target, Jackpot, Skull] {
            assert!(
                REEL_STRIP.contains(&sym),
                "{:?} is priced but never appears",
                sym
            );
        }
    }

    #[test]
    fn only_ever_produces_symbols_from_the_strip() {
        let mut rng = Mulberry32::new(7);
        let mut rand = move || rng.next_f64();
        for _ in 0..2000 {
            for s in spin(&mut rand).reels {
                assert!(REEL_STRIP.contains(&s));
            }
        }
    }

    #[test]
    fn is_deterministic_for_a_given_seed() {
        let mut a = Mulberry32::new(42);
        let mut b = Mulberry32::new(42);
        assert_eq!(
            spin(&mut || a.next_f64()).reels,
            spin(&mut || b.next_f64()).reels
        );
    }

    #[test]
    fn agrees_with_score_on_its_own_reels() {
        let mut rng = Mulberry32::new(99);
        let mut rand = move || rng.next_f64();
        for _ in 0..500 {
            let out = spin(&mut rand);
            assert_eq!(out.multiplier, score(out.reels).0);
        }
    }
}
