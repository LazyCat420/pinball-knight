//! BLACKJACK — the playable table's phase machine, ported from
//! `legacy/src/scenes/tavern/gambler/blackjack-game.ts` with the canvas
//! stripped out. Rules live in `blackjack.rs` and are not touched here; this
//! file is the timing, the cue order and the shell contract:
//!
//!  · `resolve()` exactly once per round (twice would burn a second round off
//!    the per-visit limit AND pay the hand twice).
//!  · the double-down goes through `raise()`, and does NOT double when the
//!    purse can't cover it.
//!  · the reported stake matches what was actually taken.
//!  · cue ORDER: the busting card lands BEFORE the hole card flips, the flip
//!    comes BEFORE the dealer draws, the dealer draws on an audible beat.
//!  · `busy()` covers EVERY phase still doing something — including the
//!    settle hold, which is the only time the outcome is on screen.

use super::blackjack::{dealer_should_hit, hand_value, is_blackjack, settle_hand, Card, Outcome};

/// The shell's seam — the only route to gold (mirrors legacy `PlayApi`).
pub trait BlackjackApi {
    /// Finish the round. The table guarantees exactly one call per round.
    fn resolve(&mut self, stake: i64, payout: i64, label: &str);
    /// Take an extra wager mid-round (double-down). False = can't cover it.
    fn raise(&mut self, extra: i64) -> bool;
    /// Would `raise(extra)` succeed? Asks without taking the gold.
    fn can_raise(&self, extra: i64) -> bool;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BjPhase {
    Deal,
    Player,
    Flip,
    Dealer,
    Done,
    Idle,
}

/// The audible beats, in the order they fire — what the legacy audio mocks
/// pinned. The shell maps these onto sfx.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BjCue {
    Shuffle,
    Chips,
    Deal,
    Flip,
    Double,
    DealerTick,
    Bust,
    Blackjack,
    Win,
    Push,
    Lose,
}

/// Seconds a card spends sliding out of the shoe.
pub const SLIDE: f64 = 0.22;
/// Seconds between the two cards of the opening deal.
pub const DEAL_GAP: f64 = 0.17;
/// Seconds between the dealer's draws, so the reveal has a rhythm.
pub const DEAL_BEAT: f64 = 0.46;
/// Seconds the hole card spends turning over.
pub const FLIP_TIME: f64 = 0.34;
/// Seconds the result holds before the table unlocks.
pub const SETTLE_HOLD: f64 = 2.0;

/// A card on the table, with the bookkeeping the animation needs.
#[derive(Debug, Clone)]
pub struct Dealt {
    pub card: Card,
    /// Table clock at which this card started sliding out of the shoe.
    pub t0: f64,
    /// Has its deal cue fired?
    sounded: bool,
    /// Whole-pixel shear, deterministic from the slot index.
    pub lean: i32,
}

const LEANS: [i32; 8] = [0, 2, -2, 1, -1, 2, -2, 0];

fn plain(d: &[Dealt]) -> Vec<Card> {
    d.iter().map(|x| x.card).collect()
}

#[derive(Debug, Clone)]
pub struct Control {
    pub id: &'static str,
    pub label: String,
    pub disabled: bool,
}

pub struct BlackjackTable {
    phase: BjPhase,
    deck: Vec<Card>,
    cursor: usize,
    pub player: Vec<Dealt>,
    pub dealer: Vec<Dealt>,
    stake_now: i64,
    wagered: i64,
    doubled: bool,
    /// Seconds since the round started. Drives every deal animation.
    pub clock: f64,
    beat: f64,
    flip_t: f64,
    settle_t: f64,
    pub result_label: String,
    pub result_mult: f64,
    pub outcome: Option<Outcome>,
    dealer_draws: u32,
    /// Guards the once-per-round contract on `resolve`.
    resolved: bool,
    flip_sounded: bool,
    pub idle_t: f64,
}

impl Default for BlackjackTable {
    fn default() -> Self {
        Self::new()
    }
}

impl BlackjackTable {
    pub fn new() -> Self {
        Self {
            phase: BjPhase::Idle,
            deck: Vec::new(),
            cursor: 0,
            player: Vec::new(),
            dealer: Vec::new(),
            stake_now: 0,
            wagered: 0,
            doubled: false,
            clock: 0.0,
            beat: 0.0,
            flip_t: 0.0,
            settle_t: 0.0,
            result_label: String::new(),
            result_mult: 0.0,
            outcome: None,
            dealer_draws: 0,
            resolved: true,
            flip_sounded: false,
            idle_t: 0.0,
        }
    }

    pub fn phase(&self) -> BjPhase {
        self.phase
    }

    /// True until the settle hold has fully elapsed — `busy()` must cover
    /// every phase that is still doing something (the legacy defect: it
    /// stopped at "dealer" and an immediate PLAY wiped the result plate).
    pub fn busy(&self) -> bool {
        self.phase != BjPhase::Idle
    }

    /// The hole card is face down until the flip finishes.
    pub fn hole_down(&self) -> bool {
        match self.phase {
            BjPhase::Player | BjPhase::Deal => true,
            BjPhase::Flip => {
                // The flip runs at the END of `flip_t` so a bust card can land
                // first; the face appears past the edge-on midpoint.
                let into = FLIP_TIME - self.flip_t.min(FLIP_TIME);
                (into / FLIP_TIME) < 0.5
            }
            _ => false,
        }
    }

    fn draw(&mut self) -> Card {
        let c = self.deck[self.cursor];
        self.cursor += 1;
        c
    }

    fn deal_into(&mut self, to_player: bool, at: f64) {
        let card = self.draw();
        let hand = if to_player {
            &mut self.player
        } else {
            &mut self.dealer
        };
        let lean = LEANS[hand.len() % LEANS.len()];
        hand.push(Dealt {
            card,
            t0: at,
            sounded: false,
            lean,
        });
    }

    /// Can the player still act on this hand?
    fn can_act(&self) -> bool {
        self.phase == BjPhase::Player && !hand_value(&plain(&self.player)).bust
    }

    /// True once every card on the table has finished sliding.
    fn settled(&self) -> bool {
        self.player
            .iter()
            .chain(self.dealer.iter())
            .all(|d| self.clock >= d.t0 + SLIDE)
    }

    /// Player is done acting — turn the hole card over, then the dealer plays.
    /// `extra` buys time for a card still in the air (the one that busted the
    /// hand, or the double's card) to land BEFORE the reveal starts.
    fn to_reveal(&mut self, extra: f64) {
        self.phase = BjPhase::Flip;
        self.flip_t = FLIP_TIME + extra;
        self.flip_sounded = false;
    }

    fn finish(&mut self, api: &mut dyn BlackjackApi, cues: &mut Vec<BjCue>) {
        let s = settle_hand(&plain(&self.player), &plain(&self.dealer));
        self.result_label = s.label.clone();
        self.result_mult = s.multiplier;
        self.outcome = Some(s.outcome);
        self.phase = BjPhase::Done;
        self.settle_t = SETTLE_HOLD;

        // One cue per outcome CLASS, not per label.
        match s.outcome {
            Outcome::PlayerBust => cues.push(BjCue::Bust),
            Outcome::PlayerBlackjack => cues.push(BjCue::Blackjack),
            _ if s.multiplier > 1.0 => cues.push(BjCue::Win),
            _ if s.multiplier == 1.0 => cues.push(BjCue::Push),
            _ => cues.push(BjCue::Lose),
        }

        if !self.resolved {
            self.resolved = true;
            // Report the TOTAL wagered so the shell's net stays honest about
            // a double — the extra stake was already taken via raise().
            let payout = (self.wagered as f64 * s.multiplier).round() as i64;
            api.resolve(self.wagered, payout, &s.label);
        }
    }

    /// Game-specific controls (legacy `controls()`): only during the player's
    /// turn; DOUBLE is greyed out — never silently swallowed — when it is not
    /// the opening two cards or the purse can't cover it.
    pub fn controls(&self, api: &dyn BlackjackApi) -> Vec<Control> {
        if self.phase != BjPhase::Player {
            return Vec::new();
        }
        let two = self.player.len() == 2;
        let affordable = api.can_raise(self.stake_now);
        vec![
            Control {
                id: "hit",
                label: "HIT".into(),
                disabled: false,
            },
            Control {
                id: "stand",
                label: "STAND".into(),
                disabled: false,
            },
            Control {
                id: "double",
                label: format!("DOUBLE +{}g", self.stake_now),
                disabled: !two || self.doubled || !affordable,
            },
        ]
    }

    /// Leaving the table mid-hand: drop the round state so a disposed table
    /// can't be rendered back to life holding a forfeited hand.
    pub fn dispose(&mut self) {
        self.phase = BjPhase::Idle;
        self.player.clear();
        self.dealer.clear();
        self.resolved = true;
        self.settle_t = 0.0;
        self.wagered = 0;
    }

    pub fn on_control(&mut self, id: &str, api: &mut dyn BlackjackApi, cues: &mut Vec<BjCue>) {
        if !self.can_act() {
            return;
        }
        match id {
            "hit" => {
                let at = self.clock;
                self.deal_into(true, at);
                // A bust ends the hand without the dealer drawing — but the
                // card that busted still has to land, and the hole card still
                // turns over, or the player never sees what they were up against.
                if hand_value(&plain(&self.player)).bust {
                    self.to_reveal(SLIDE);
                }
            }
            "stand" => self.to_reveal(0.0),
            "double" => {
                if self.player.len() != 2 || self.doubled {
                    return;
                }
                // Ask the shell for the extra stake. Refused = the hand simply
                // continues undoubled rather than doubling for free.
                if !api.raise(self.stake_now) {
                    return;
                }
                self.doubled = true;
                self.wagered = self.stake_now * 2;
                cues.push(BjCue::Double);
                let at = self.clock;
                self.deal_into(true, at);
                // A double takes exactly one card, then stands.
                self.to_reveal(SLIDE);
            }
            _ => {}
        }
    }

    /// Begin a round. The deck is injected (the shell shuffles; tests stack).
    pub fn play(&mut self, stake: i64, deck: Vec<Card>, cues: &mut Vec<BjCue>) {
        self.deck = deck;
        self.cursor = 0;
        self.stake_now = stake;
        self.wagered = stake;
        self.doubled = false;
        self.resolved = false;
        self.player.clear();
        self.dealer.clear();
        self.clock = 0.0;
        self.flip_t = 0.0;
        self.settle_t = 0.0;
        self.dealer_draws = 0;
        self.result_label.clear();
        self.result_mult = 0.0;
        self.outcome = None;
        self.idle_t = 0.0;

        // Real dealing order: player, dealer, player, dealer. The hole card is
        // the LAST one out of the shoe — that's why it's the one face down.
        self.deal_into(true, 0.0);
        self.deal_into(false, DEAL_GAP);
        self.deal_into(true, DEAL_GAP * 2.0);
        self.deal_into(false, DEAL_GAP * 3.0);

        cues.push(BjCue::Shuffle);
        cues.push(BjCue::Chips);
        self.phase = BjPhase::Deal;
    }

    /// One frame of the phase clock (the phase half of legacy `render`).
    pub fn tick(&mut self, dt: f64, api: &mut dyn BlackjackApi) -> Vec<BjCue> {
        let mut cues = Vec::new();
        self.clock += dt;

        // Deal cues fire as each card starts its slide (legacy fires them
        // from the paint loop; the moment is `clock >= t0`).
        if self.phase != BjPhase::Idle {
            let clock = self.clock;
            for d in self.player.iter_mut().chain(self.dealer.iter_mut()) {
                if !d.sounded && clock >= d.t0 {
                    d.sounded = true;
                    cues.push(BjCue::Deal);
                }
            }
        }

        match self.phase {
            BjPhase::Deal => {
                if self.settled() {
                    // A natural on either side ends the hand immediately —
                    // but the hole card must still be turned over to show why.
                    if is_blackjack(&plain(&self.player)) || is_blackjack(&plain(&self.dealer)) {
                        self.to_reveal(0.0);
                    } else {
                        self.phase = BjPhase::Player;
                    }
                }
            }
            BjPhase::Flip => {
                self.flip_t -= dt;
                // The cue fires when the card actually STARTS turning, not
                // when the phase was entered.
                if !self.flip_sounded && self.flip_t <= FLIP_TIME {
                    self.flip_sounded = true;
                    cues.push(BjCue::Flip);
                }
                if self.flip_t <= 0.0 {
                    if hand_value(&plain(&self.player)).bust {
                        self.finish(api, &mut cues);
                    } else {
                        self.phase = BjPhase::Dealer;
                        self.beat = DEAL_BEAT;
                    }
                }
            }
            BjPhase::Dealer => {
                self.beat -= dt;
                if self.beat <= 0.0 && self.settled() {
                    self.beat = DEAL_BEAT;
                    if is_blackjack(&plain(&self.player)) || is_blackjack(&plain(&self.dealer)) {
                        self.finish(api, &mut cues);
                    } else if dealer_should_hit(&plain(&self.dealer)) {
                        let at = self.clock;
                        self.deal_into(false, at);
                        self.dealer_draws += 1;
                        cues.push(BjCue::DealerTick);
                    } else {
                        self.finish(api, &mut cues);
                    }
                }
            }
            BjPhase::Done => {
                if self.settle_t > 0.0 {
                    self.settle_t -= dt;
                    if self.settle_t <= 0.0 {
                        self.phase = BjPhase::Idle;
                    }
                }
            }
            BjPhase::Idle => {
                self.idle_t += dt;
            }
            BjPhase::Player => {}
        }
        cues
    }
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/gambler/blackjack-game.test.ts`
    //! (the canvas layout case stays with the legacy painters).
    use super::*;
    use crate::gambler::blackjack::{fresh_deck, Suit};

    fn c(rank: u8) -> Card {
        Card {
            rank,
            suit: Suit::Spades,
        }
    }

    /// Deal order is player, dealer, player, dealer — a stacked shoe reads
    /// p0, d0, p1, d1 and anything after is drawn in turn.
    fn shoe(cards: &[Card]) -> Vec<Card> {
        let mut deck = cards.to_vec();
        deck.extend(fresh_deck());
        deck
    }

    struct Harness {
        resolves: Vec<(i64, i64, String)>,
        raises: Vec<i64>,
        allow_raise: bool,
    }
    impl BlackjackApi for Harness {
        fn resolve(&mut self, stake: i64, payout: i64, label: &str) {
            self.resolves.push((stake, payout, label.into()));
        }
        fn raise(&mut self, extra: i64) -> bool {
            self.raises.push(extra);
            self.allow_raise
        }
        fn can_raise(&self, _extra: i64) -> bool {
            self.allow_raise
        }
    }

    fn make(stack: &[Card], allow_raise: bool) -> (BlackjackTable, Harness, Vec<BjCue>) {
        let mut t = BlackjackTable::new();
        let mut cues = Vec::new();
        let h = Harness {
            resolves: Vec::new(),
            raises: Vec::new(),
            allow_raise,
        };
        t.play(20, shoe(stack), &mut cues);
        (t, h, cues)
    }

    /// Advance the table (legacy stepped at 1/30 — every threshold is an order
    /// of magnitude longer, so the phase sequence is identical).
    fn step(t: &mut BlackjackTable, h: &mut Harness, cues: &mut Vec<BjCue>, seconds: f64) {
        let mut e = 0.0;
        while e < seconds {
            cues.extend(t.tick(1.0 / 30.0, h));
            e += 1.0 / 30.0;
        }
    }

    #[test]
    fn resolves_exactly_once_on_a_stand() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(9), c(9), c(8)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        assert_eq!(h.resolves.len(), 1);
    }

    #[test]
    fn resolves_exactly_once_on_a_bust_and_never_lets_the_dealer_draw() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(6), c(9), c(9), c(13)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("hit", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        assert_eq!(h.resolves.len(), 1);
        assert_eq!(h.resolves[0].1, 0);
        // The dealer's 15 would have drawn given the chance. A player bust
        // must lose before that happens — that asymmetry IS the house edge.
        assert!(!cues.contains(&BjCue::DealerTick));
    }

    #[test]
    fn resolves_exactly_once_on_a_natural_with_nobody_acting() {
        let (mut t, mut h, mut cues) = make(&[c(1), c(9), c(13), c(8)], true);
        step(&mut t, &mut h, &mut cues, 6.0);
        assert_eq!(h.resolves.len(), 1);
        assert_eq!(h.resolves[0].1, 50); // 20g at 3:2
    }

    #[test]
    fn does_not_resolve_again_once_the_table_has_gone_idle() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(9), c(9), c(8)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 12.0);
        // Late clicks after the hand is over must not restart anything.
        t.on_control("hit", &mut h, &mut cues);
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 4.0);
        assert_eq!(h.resolves.len(), 1);
    }

    #[test]
    fn ignores_actions_once_the_player_has_busted() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(6), c(9), c(9), c(13), c(2)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("hit", &mut h, &mut cues);
        t.on_control("hit", &mut h, &mut cues);
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        assert_eq!(h.resolves.len(), 1);
    }

    #[test]
    fn double_goes_through_raise_and_reports_the_doubled_stake() {
        let (mut t, mut h, mut cues) = make(&[c(6), c(9), c(5), c(8), c(10)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("double", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        assert_eq!(h.raises, vec![20]);
        assert_eq!(h.resolves[0].0, 40);
        // 21 against the dealer's 17 — paid 2x the total wagered.
        assert_eq!(h.resolves[0].1, 80);
    }

    #[test]
    fn double_stays_on_the_original_stake_when_the_purse_cant_cover_it() {
        let (mut t, mut h, mut cues) = make(&[c(6), c(9), c(5), c(8), c(10)], false);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("double", &mut h, &mut cues);
        assert_eq!(h.raises, vec![20]);
        // Refused: the hand is still live and still on one stake.
        assert!(!t.controls(&h).is_empty());
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        assert_eq!(h.resolves[0].0, 20);
    }

    #[test]
    fn double_can_only_be_taken_on_the_opening_two_cards() {
        let (mut t, mut h, mut cues) = make(&[c(4), c(9), c(3), c(8), c(2), c(10)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("hit", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 0.5);
        t.on_control("double", &mut h, &mut cues);
        assert!(h.raises.is_empty());
        assert!(
            t.controls(&h)
                .iter()
                .find(|x| x.id == "double")
                .unwrap()
                .disabled
        );
    }

    #[test]
    fn double_takes_exactly_one_card_and_then_stands() {
        let (mut t, mut h, mut cues) = make(&[c(6), c(9), c(5), c(8), c(2), c(9)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("double", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        // 13, not 22: a double draws once and stops.
        assert!(h.resolves[0].2.contains("13"));
    }

    #[test]
    fn deals_four_cards_then_hands_over_to_the_player() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(9), c(9), c(8)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        assert_eq!(cues.iter().filter(|x| **x == BjCue::Deal).count(), 4);
        assert_eq!(cues[0], BjCue::Shuffle);
        assert_eq!(cues[1], BjCue::Chips);
        // Nothing has been revealed and nothing has resolved yet.
        assert!(!cues.contains(&BjCue::Flip));
        assert_eq!(
            t.controls(&h).iter().map(|x| x.id).collect::<Vec<_>>(),
            vec!["hit", "stand", "double"]
        );
    }

    #[test]
    fn flips_the_hole_card_before_the_dealer_draws() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(2), c(9), c(3), c(5), c(6)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        let flip = cues.iter().position(|x| *x == BjCue::Flip).unwrap();
        let tick = cues.iter().position(|x| *x == BjCue::DealerTick).unwrap();
        assert!(flip < tick);
        // The dealer's 5 walked up through 10 and 16 to 21 — three draws,
        // each audible, rather than the whole hand between two frames.
        assert!(cues.iter().filter(|x| **x == BjCue::DealerTick).count() >= 2);
    }

    #[test]
    fn lands_the_busting_card_before_it_turns_the_hole_card_over() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(6), c(9), c(9), c(13)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        let before = cues.len();
        t.on_control("hit", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 6.0);
        let after = &cues[before..];
        let deal = after.iter().position(|x| *x == BjCue::Deal).unwrap();
        let flip = after.iter().position(|x| *x == BjCue::Flip).unwrap();
        assert!(deal < flip);
        assert!(after.contains(&BjCue::Bust));
    }

    #[test]
    fn gives_each_outcome_its_own_cue() {
        let outcome_set = [
            BjCue::Bust,
            BjCue::Blackjack,
            BjCue::Win,
            BjCue::Push,
            BjCue::Lose,
        ];
        let cases: Vec<(BjCue, Vec<Card>)> = vec![
            (BjCue::Bust, vec![c(10), c(6), c(9), c(9), c(13)]),
            (BjCue::Blackjack, vec![c(1), c(9), c(13), c(8)]),
            (BjCue::Push, vec![c(10), c(10), c(9), c(9)]),
            (BjCue::Win, vec![c(10), c(10), c(10), c(9)]),
            (BjCue::Lose, vec![c(10), c(10), c(8), c(9)]),
        ];
        for (expected, stack) in cases {
            let (mut t, mut h, mut cues) = make(&stack, true);
            step(&mut t, &mut h, &mut cues, 1.2);
            if expected == BjCue::Bust {
                t.on_control("hit", &mut h, &mut cues);
            } else {
                t.on_control("stand", &mut h, &mut cues);
            }
            step(&mut t, &mut h, &mut cues, 6.0);
            let outcome_cues: Vec<_> = cues.iter().filter(|x| outcome_set.contains(x)).collect();
            assert_eq!(outcome_cues, vec![&expected], "{expected:?}");
        }
    }

    #[test]
    fn keeps_the_table_busy_until_the_hand_is_completely_over() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(2), c(9), c(3), c(5), c(6)], true);
        assert!(t.busy()); // dealing
        step(&mut t, &mut h, &mut cues, 1.2);
        assert!(t.busy()); // player's turn
        t.on_control("stand", &mut h, &mut cues);
        assert!(t.busy()); // flipping
        step(&mut t, &mut h, &mut cues, 6.0);
        // Settled and unlocked — the shell can offer another round.
        assert!(!t.busy());
        assert!(t.controls(&h).is_empty());
    }

    #[test]
    fn stays_busy_through_the_settle_hold_not_just_to_the_last_card() {
        // Player 20, dealer 19 — the dealer stands at once, so the hand
        // reaches `done` about 0.8s after the stand and then holds.
        let (mut t, mut h, mut cues) = make(&[c(10), c(10), c(10), c(9)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        t.on_control("stand", &mut h, &mut cues);
        step(&mut t, &mut h, &mut cues, 1.5); // flip + one beat: into the hold

        assert_eq!(h.resolves.len(), 1, "the hand should have settled by now");
        assert!(
            t.busy(),
            "the result plate is still up — the table is not free"
        );

        // ...and it does eventually let go, or the cabinet would lock for good.
        step(&mut t, &mut h, &mut cues, 2.5);
        assert!(!t.busy());
    }

    #[test]
    fn clears_the_hand_on_dispose() {
        let (mut t, mut h, mut cues) = make(&[c(10), c(2), c(9), c(3)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        assert!(t.busy());
        t.dispose();
        // A disposed table is idle, offers nothing, and is safe to tick.
        assert!(!t.busy());
        assert!(t.controls(&h).is_empty());
        step(&mut t, &mut h, &mut cues, 0.5);
    }

    #[test]
    fn double_is_offered_when_the_purse_covers_it() {
        let (mut t, mut h, mut cues) = make(&[c(5), c(10), c(6), c(9)], true);
        step(&mut t, &mut h, &mut cues, 1.2);
        let ctrls = t.controls(&h);
        let double = ctrls.iter().find(|x| x.id == "double").unwrap();
        assert!(!double.disabled);
    }

    #[test]
    fn double_is_disabled_when_the_purse_cannot_cover_it() {
        let (mut t, mut h, mut cues) = make(&[c(5), c(10), c(6), c(9)], false);
        step(&mut t, &mut h, &mut cues, 1.2);
        let ctrls = t.controls(&h);
        let double = ctrls.iter().find(|x| x.id == "double");
        assert!(double.is_some(), "DOUBLE should still be listed, just dead");
        assert!(double.unwrap().disabled);
        // HIT and STAND are unaffected — only the option that costs gold goes.
        assert!(!ctrls.iter().find(|x| x.id == "hit").unwrap().disabled);
    }
}
