//! BLACKJACK — "Twenty-One". Port of
//! `legacy/src/scenes/tavern/gambler/blackjack.ts`.
//!
//! Deliberately trimmed rules: single deck reshuffled every round (kills card
//! counting), dealer stands on ALL 17 including soft, blackjack pays 3:2,
//! Hit / Stand / Double only. Lands near 98% under decent play. Everything
//! pure: a seedable deck, resolution as data, RTP measured by simulating
//! basic strategy.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Suit {
    Spades,
    Hearts,
    Diamonds,
    Clubs,
}

pub const SUITS: [Suit; 4] = [Suit::Spades, Suit::Hearts, Suit::Diamonds, Suit::Clubs];

pub const RED_SUITS: [Suit; 2] = [Suit::Hearts, Suit::Diamonds];

/// 1 = ace, 11..13 = J/Q/K.
pub type Rank = u8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
}

/// Short label for a rank — what gets drawn in the card's corner.
pub fn rank_label(rank: Rank) -> String {
    match rank {
        1 => "A".into(),
        11 => "J".into(),
        12 => "Q".into(),
        13 => "K".into(),
        n => n.to_string(),
    }
}

/// Blackjack value of a rank. Aces count 11 here; `hand_value` demotes them.
pub fn card_value(rank: Rank) -> i32 {
    if rank == 1 {
        return 11;
    }
    if rank >= 10 {
        10
    } else {
        i32::from(rank)
    }
}

/// A fresh 52-card deck in order.
pub fn fresh_deck() -> Vec<Card> {
    let mut deck = Vec::with_capacity(52);
    for suit in SUITS {
        for rank in 1..=13 {
            deck.push(Card { rank, suit });
        }
    }
    deck
}

/// Fisher-Yates. Seedable so a test can replay an exact shoe.
pub fn shuffle(deck: &[Card], rand: &mut dyn FnMut() -> f64) -> Vec<Card> {
    let mut out = deck.to_vec();
    for i in (1..out.len()).rev() {
        let j = (rand() * (i as f64 + 1.0)).floor() as usize;
        out.swap(i, j);
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HandValue {
    /// Best total that isn't a bust, or the minimum total if every option busts.
    pub total: i32,
    /// True if an ace is still counted as 11 — the hand can absorb a hit.
    pub soft: bool,
    pub bust: bool,
}

/// Score a hand, demoting aces from 11 to 1 only as far as needed:
/// A+A+9 is 21, not 12 and not 31.
pub fn hand_value(cards: &[Card]) -> HandValue {
    let mut total = 0;
    let mut aces = 0;
    for c in cards {
        total += card_value(c.rank);
        if c.rank == 1 {
            aces += 1;
        }
    }
    let mut soft_aces = aces;
    while total > 21 && soft_aces > 0 {
        total -= 10;
        soft_aces -= 1;
    }
    HandValue {
        total,
        soft: soft_aces > 0,
        bust: total > 21,
    }
}

/// A natural: exactly two cards totalling 21.
pub fn is_blackjack(cards: &[Card]) -> bool {
    cards.len() == 2 && hand_value(cards).total == 21
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    PlayerBlackjack,
    PlayerWin,
    DealerWin,
    Push,
    PlayerBust,
    DealerBust,
}

#[derive(Debug, Clone)]
pub struct Settlement {
    pub outcome: Outcome,
    /// Stake multiplier, stake INCLUDED. 0 = lost, 1 = push, 2 = win, 2.5 = natural.
    pub multiplier: f64,
    pub label: String,
}

/// Dealer draws until 17 or more. Stands on all 17, soft included.
pub fn dealer_should_hit(cards: &[Card]) -> bool {
    hand_value(cards).total < 17
}

/// Settle a finished hand. Order matters: busts first (a player bust loses
/// even if the dealer would also have busted — that asymmetry IS the house
/// edge), then naturals, then totals.
pub fn settle_hand(player: &[Card], dealer: &[Card]) -> Settlement {
    let p = hand_value(player);
    let d = hand_value(dealer);

    if p.bust {
        return Settlement {
            outcome: Outcome::PlayerBust,
            multiplier: 0.0,
            label: format!("BUST — {}", p.total),
        };
    }

    let p_bj = is_blackjack(player);
    let d_bj = is_blackjack(dealer);
    if p_bj && d_bj {
        return Settlement {
            outcome: Outcome::Push,
            multiplier: 1.0,
            label: "BOTH BLACKJACK — PUSH".into(),
        };
    }
    if p_bj {
        return Settlement {
            outcome: Outcome::PlayerBlackjack,
            multiplier: 2.5,
            label: "BLACKJACK!".into(),
        };
    }
    if d_bj {
        return Settlement {
            outcome: Outcome::DealerWin,
            multiplier: 0.0,
            label: "DEALER BLACKJACK".into(),
        };
    }

    if d.bust {
        return Settlement {
            outcome: Outcome::DealerBust,
            multiplier: 2.0,
            label: format!("DEALER BUST — {}", d.total),
        };
    }
    if p.total > d.total {
        return Settlement {
            outcome: Outcome::PlayerWin,
            multiplier: 2.0,
            label: format!("{} BEATS {}", p.total, d.total),
        };
    }
    if p.total < d.total {
        return Settlement {
            outcome: Outcome::DealerWin,
            multiplier: 0.0,
            label: format!("{} BEATS {}", d.total, p.total),
        };
    }
    Settlement {
        outcome: Outcome::Push,
        multiplier: 1.0,
        label: format!("PUSH ON {}", p.total),
    }
}

// ── Basic strategy — used by the RTP test, not by the game. ──

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Move {
    Hit,
    Stand,
    Double,
}

/// What basic strategy says to do. `can_double` is false after the first
/// decision — you may only double on your opening two cards.
pub fn basic_strategy(player: &[Card], dealer_up: Card, can_double: bool) -> Move {
    let HandValue { total, soft, .. } = hand_value(player);
    let up = card_value(dealer_up.rank);
    // Treat the dealer's ace as 11 for the strategy table.
    let dealer_strong = up >= 7 || up == 11;

    if soft {
        // Soft hands: an ace absorbing a hit means hitting is much safer.
        if total >= 19 {
            return Move::Stand;
        }
        if total == 18 {
            if can_double && (3..=6).contains(&up) {
                return Move::Double;
            }
            return if dealer_strong && up != 7 {
                Move::Hit
            } else {
                Move::Stand
            };
        }
        if can_double && (15..=17).contains(&total) && (4..=6).contains(&up) {
            return Move::Double;
        }
        if can_double && (13..=14).contains(&total) && (5..=6).contains(&up) {
            return Move::Double;
        }
        return Move::Hit;
    }

    // Hard hands.
    if total >= 17 {
        return Move::Stand;
    }
    if (13..=16).contains(&total) {
        return if dealer_strong {
            Move::Hit
        } else {
            Move::Stand
        };
    }
    if total == 12 {
        return if (4..=6).contains(&up) {
            Move::Stand
        } else {
            Move::Hit
        };
    }
    if total == 11 {
        return if can_double { Move::Double } else { Move::Hit };
    }
    if total == 10 {
        return if can_double && up <= 9 {
            Move::Double
        } else {
            Move::Hit
        };
    }
    if total == 9 {
        return if can_double && (3..=6).contains(&up) {
            Move::Double
        } else {
            Move::Hit
        };
    }
    Move::Hit
}

/// Play one full hand under basic strategy and return the stake multiplier.
/// Doubling stakes twice the money, so its return is doubled too.
// `doubled = true` before the break mirrors the legacy flow verbatim, even
// though the double always ends the decision loop.
#[allow(unused_assignments)]
pub fn simulate_hand(rand: &mut dyn FnMut() -> f64) -> (f64, f64) {
    let deck = shuffle(&fresh_deck(), rand);
    let mut i = 0usize;
    let mut draw = || {
        let c = deck[i];
        i += 1;
        c
    };

    let mut player = vec![draw(), draw()];
    let mut dealer = vec![draw(), draw()];

    let mut wagered = 1.0;
    let mut doubled = false;
    let mut first = true;

    // Naturals resolve before anyone acts.
    if !is_blackjack(&player) && !is_blackjack(&dealer) {
        loop {
            if hand_value(&player).bust {
                break;
            }
            let mv = basic_strategy(&player, dealer[0], first && !doubled);
            first = false;
            match mv {
                Move::Stand => break,
                Move::Double => {
                    wagered = 2.0;
                    doubled = true;
                    player.push(draw());
                    break; // a double takes exactly one card, then stands
                }
                Move::Hit => player.push(draw()),
            }
        }

        if !hand_value(&player).bust {
            while dealer_should_hit(&dealer) {
                dealer.push(draw());
            }
        }
    }

    let s = settle_hand(&player, &dealer);
    (s.multiplier * wagered, wagered)
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/gambler/blackjack.test.ts` (the
    //! card-art case stays with the legacy canvas painters).
    use super::*;
    use crate::rng::Mulberry32;
    use std::collections::HashSet;

    fn c(rank: Rank) -> Card {
        Card {
            rank,
            suit: Suit::Spades,
        }
    }

    fn seeded(seed: u32) -> impl FnMut() -> f64 {
        let mut rng = Mulberry32::new(seed);
        move || rng.next_f64()
    }

    fn key(card: &Card) -> String {
        format!("{}{:?}", card.rank, card.suit)
    }

    #[test]
    fn has_52_unique_cards() {
        let deck = fresh_deck();
        assert_eq!(deck.len(), 52);
        assert_eq!(deck.iter().map(key).collect::<HashSet<_>>().len(), 52);
    }

    #[test]
    fn shuffles_without_losing_or_duplicating_a_card() {
        let shuffled = shuffle(&fresh_deck(), &mut seeded(5));
        assert_eq!(shuffled.len(), 52);
        assert_eq!(shuffled.iter().map(key).collect::<HashSet<_>>().len(), 52);
    }

    #[test]
    fn actually_changes_the_order() {
        let a = fresh_deck();
        let b = shuffle(&a, &mut seeded(9));
        assert_ne!(
            b.iter().map(key).collect::<Vec<_>>(),
            a.iter().map(key).collect::<Vec<_>>()
        );
    }

    #[test]
    fn counts_faces_as_ten() {
        assert_eq!(card_value(11), 10);
        assert_eq!(card_value(12), 10);
        assert_eq!(card_value(13), 10);
        assert_eq!(card_value(10), 10);
    }

    #[test]
    fn counts_an_ace_as_eleven_before_demotion() {
        assert_eq!(card_value(1), 11);
    }

    #[test]
    fn labels_ranks_the_way_a_card_face_reads() {
        assert_eq!(rank_label(1), "A");
        assert_eq!(rank_label(11), "J");
        assert_eq!(rank_label(13), "K");
        assert_eq!(rank_label(7), "7");
    }

    #[test]
    fn scores_a_simple_hard_hand() {
        assert_eq!(hand_value(&[c(9), c(7)]).total, 16);
    }

    #[test]
    fn counts_a_lone_ace_as_eleven_and_calls_it_soft() {
        let v = hand_value(&[c(1), c(6)]);
        assert_eq!(v.total, 17);
        assert!(v.soft);
    }

    #[test]
    fn demotes_an_ace_to_avoid_a_bust() {
        let v = hand_value(&[c(1), c(6), c(10)]);
        assert_eq!(v.total, 17);
        assert!(!v.soft);
    }

    #[test]
    fn demotes_only_as_far_as_needed_a_a_9_is_21_not_12_or_31() {
        assert_eq!(hand_value(&[c(1), c(1), c(9)]).total, 21);
    }

    #[test]
    fn handles_four_aces() {
        assert_eq!(hand_value(&[c(1), c(1), c(1), c(1)]).total, 14);
    }

    #[test]
    fn busts_when_it_must() {
        let v = hand_value(&[c(10), c(9), c(5)]);
        assert_eq!(v.total, 24);
        assert!(v.bust);
    }

    #[test]
    fn twenty_one_is_not_a_bust() {
        assert!(!hand_value(&[c(10), c(5), c(6)]).bust);
    }

    #[test]
    fn blackjack_is_exactly_two_cards_totalling_21() {
        assert!(is_blackjack(&[c(1), c(13)]));
    }

    #[test]
    fn blackjack_is_not_three_cards_making_21() {
        assert!(!is_blackjack(&[c(7), c(7), c(7)]));
    }

    #[test]
    fn dealer_hits_below_17() {
        assert!(dealer_should_hit(&[c(10), c(6)]));
    }

    #[test]
    fn dealer_stands_on_hard_17() {
        assert!(!dealer_should_hit(&[c(10), c(7)]));
    }

    #[test]
    fn dealer_stands_on_soft_17_too_the_house_rule_here() {
        assert!(!dealer_should_hit(&[c(1), c(6)]));
    }

    #[test]
    fn a_player_bust_loses_even_though_the_dealer_never_draws() {
        assert_eq!(
            settle_hand(&[c(10), c(9), c(5)], &[c(10), c(6)]).multiplier,
            0.0
        );
    }

    #[test]
    fn pays_a_natural_3_to_2() {
        assert_eq!(settle_hand(&[c(1), c(13)], &[c(10), c(9)]).multiplier, 2.5);
    }

    #[test]
    fn pushes_when_both_have_a_natural() {
        assert_eq!(settle_hand(&[c(1), c(13)], &[c(1), c(12)]).multiplier, 1.0);
    }

    #[test]
    fn a_dealer_natural_beats_a_non_natural_21() {
        assert_eq!(
            settle_hand(&[c(7), c(7), c(7)], &[c(1), c(10)]).multiplier,
            0.0
        );
    }

    #[test]
    fn pays_2x_on_a_dealer_bust() {
        assert_eq!(
            settle_hand(&[c(10), c(8)], &[c(10), c(6), c(9)]).multiplier,
            2.0
        );
    }

    #[test]
    fn pays_2x_on_the_higher_total() {
        assert_eq!(settle_hand(&[c(10), c(10)], &[c(10), c(9)]).multiplier, 2.0);
    }

    #[test]
    fn pushes_on_equal_totals() {
        assert_eq!(settle_hand(&[c(10), c(9)], &[c(10), c(9)]).multiplier, 1.0);
    }

    #[test]
    fn loses_to_the_higher_dealer_total() {
        assert_eq!(settle_hand(&[c(10), c(7)], &[c(10), c(9)]).multiplier, 0.0);
    }

    #[test]
    fn strategy_stands_on_hard_17_or_better() {
        assert_eq!(basic_strategy(&[c(10), c(7)], c(10), false), Move::Stand);
    }

    #[test]
    fn strategy_always_hits_11_or_lower_when_it_cant_double() {
        assert_eq!(basic_strategy(&[c(5), c(4)], c(10), false), Move::Hit);
    }

    #[test]
    fn strategy_doubles_11() {
        assert_eq!(basic_strategy(&[c(6), c(5)], c(6), true), Move::Double);
    }

    #[test]
    fn strategy_stands_stiff_hands_against_a_weak_dealer_card() {
        assert_eq!(basic_strategy(&[c(10), c(3)], c(5), false), Move::Stand);
    }

    #[test]
    fn strategy_hits_stiff_hands_against_a_strong_dealer_card() {
        assert_eq!(basic_strategy(&[c(10), c(3)], c(10), false), Move::Hit);
    }

    #[test]
    fn strategy_never_doubles_once_the_hand_is_past_its_first_decision() {
        assert_ne!(basic_strategy(&[c(6), c(5)], c(6), false), Move::Double);
    }

    #[test]
    fn rtp_lands_near_98_percent_the_target_for_the_skill_game() {
        let mut rand = seeded(20260719);
        let mut wagered = 0.0;
        let mut returned = 0.0;
        for _ in 0..200_000 {
            let (m, w) = simulate_hand(&mut rand);
            wagered += w;
            returned += m;
        }
        let rtp = returned / wagered;
        assert!(rtp > 0.95, "rtp {rtp}");
        assert!(rtp < 1.0, "rtp {rtp}");
    }

    #[test]
    fn rtp_never_pays_over_100_percent_the_house_must_still_win() {
        let mut rand = seeded(777);
        let mut wagered = 0.0;
        let mut returned = 0.0;
        for _ in 0..120_000 {
            let (m, w) = simulate_hand(&mut rand);
            wagered += w;
            returned += m;
        }
        assert!(returned / wagered < 1.0);
    }

    #[test]
    fn rtp_beats_the_other_games_returns_skill_should_pay_best() {
        let mut rand = seeded(31337);
        let mut wagered = 0.0;
        let mut returned = 0.0;
        for _ in 0..120_000 {
            let (m, w) = simulate_hand(&mut rand);
            wagered += w;
            returned += m;
        }
        // Slots ~0.90, roulette ~0.947. Blackjack must clear roulette.
        assert!(returned / wagered > 0.947);
    }
}
