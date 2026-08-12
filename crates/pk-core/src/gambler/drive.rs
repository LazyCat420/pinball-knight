//! THE GAME DRIVERS — what turns the four rulesets into playable rounds.
//!
//! Ports the round-driving halves of `slots-game.ts`, `roulette-game.ts` and
//! `darts-game.ts`. Blackjack already has one
//! ([`super::blackjack_table::BlackjackTable`]), so it is not repeated here.
//!
//! ## What is here and what is NOT
//!
//! Here: the clock, the phase, when a round ends, and what it paid. NOT here:
//! any pixel. The legacy files are mostly `fillRect` calls — 679 lines for
//! slots alone — and those belong to the GUI, which turns this state into a
//! `GamePaint`. Splitting at that line is what keeps the animation testable
//! headlessly, which is how these timings are pinned below.
//!
//! ## The one rule every driver obeys
//!
//! **The outcome is decided when the round STARTS, not when the animation
//! ends.** The legacy slots header is explicit about why: *"That is how real
//! machines work and it matters here for a specific reason: it means the
//! animation can never disagree with the payout. A reel that 'lands' somewhere
//! and then pays something else is the single worst bug a slot machine can
//! have."* So `play()` rolls the result immediately and the tick only reveals
//! it — and a driver that is torn down mid-round still knows what it owed.

use super::darts_throw::{ThrowEvent, ThrowMachine};
use super::roulette::{settle_bet, spin_wheel, BetDef};
use super::roulette_physics::{frame_at, plan_spin, BallFrame, Spin};
use super::slots::{spin, SpinOutcome, Symbol};
use super::table::{GameId, RoundResult};

/// Seconds each reel spins before it may stop, indexed by reel.
///
/// ⚠️ COPIED PER SPIN, never mutated in place. The legacy version kept this as
/// a module-level `const` and `poke()` wrote THROUGH it; `play()` restored the
/// values so nothing was visibly broken, but as its comment says, the restore
/// "was the only thing standing between a slammed button and every future slot
/// machine in the process inheriting a shortened reel".
pub const STOP_AT_DEFAULT: [f64; 3] = [0.7, 1.25, 1.95];

/// Seconds the win banner holds before the controls unlock.
pub const SLOTS_SETTLE_HOLD: f64 = 0.9;

/// How far forward a poke may pull a reel, and the floor it may not cross.
const POKE_PULL: f64 = 0.35;
const POKE_FLOOR: f64 = 0.08;

/// The one-armed bandit's round.
#[derive(Debug, Clone, Default)]
pub struct SlotsDrive {
    t: f64,
    spinning: bool,
    /// THIS machine's live schedule, copied from [`STOP_AT_DEFAULT`] each spin.
    stop_at: [f64; 3],
    outcome: Option<SpinOutcome>,
    stake: i64,
}

impl SlotsDrive {
    pub fn new() -> Self {
        Self {
            stop_at: STOP_AT_DEFAULT,
            ..Default::default()
        }
    }

    /// Begin a round. The outcome is rolled NOW — see the module header.
    pub fn play(&mut self, stake: i64, rand: &mut dyn FnMut() -> f64) {
        if self.spinning {
            return;
        }
        self.t = 0.0;
        self.stop_at = STOP_AT_DEFAULT;
        self.stake = stake;
        self.outcome = Some(spin(rand));
        self.spinning = true;
    }

    /// Has reel `i` come to rest?
    pub fn stopped(&self, i: usize) -> bool {
        !self.spinning || self.t >= self.stop_at[i]
    }

    pub fn busy(&self) -> bool {
        self.spinning
    }

    pub fn reels(&self) -> Option<[Symbol; 3]> {
        self.outcome.as_ref().map(|o| o.reels)
    }

    pub fn label(&self) -> &str {
        self.outcome.as_ref().map_or("", |o| o.label.as_str())
    }

    /// The primary key mid-round: pull the leftmost still-spinning reel in.
    ///
    /// ⚠️ It may never pull a stop to `t` or before — a reel that stops on the
    /// frame you asked reads as the machine ignoring you, and one that stops
    /// BEFORE `t` has already passed its own stop test, so the drum would jump.
    pub fn poke(&mut self) {
        if !self.spinning {
            return;
        }
        for i in 0..3 {
            if self.t < self.stop_at[i] {
                self.stop_at[i] = (self.stop_at[i] - POKE_PULL).max(self.t + POKE_FLOOR);
                break;
            }
        }
    }

    /// Advance the animation. Returns the round's result on the frame it ends.
    pub fn tick(&mut self, dt: f64) -> Option<RoundResult> {
        if !self.spinning {
            return None;
        }
        self.t += dt;
        // The banner holds AFTER the last reel, so the player reads the line
        // before the controls come back.
        if self.t < self.stop_at[2] + SLOTS_SETTLE_HOLD {
            return None;
        }
        self.spinning = false;
        let o = self.outcome.as_ref()?;
        Some(RoundResult {
            game: GameId::Slots,
            stake: self.stake,
            payout: (self.stake as f64 * o.multiplier).round() as i64,
            label: o.label.clone(),
        })
    }

    /// What this round owes if it is torn down mid-flight.
    ///
    /// The legacy shell keeps a `forfeitRound` closure for exactly this and
    /// says why: without it "a teardown eats the stake". The outcome was
    /// already rolled at `play`, so a forfeit pays what the player WON — it is
    /// not a loss, it is an early settle.
    pub fn forfeit(&mut self) -> Option<RoundResult> {
        if !self.spinning {
            return None;
        }
        self.spinning = false;
        let o = self.outcome.as_ref()?;
        Some(RoundResult {
            game: GameId::Slots,
            stake: self.stake,
            payout: (self.stake as f64 * o.multiplier).round() as i64,
            label: o.label.clone(),
        })
    }
}

/// Seconds the wheel's result holds before the controls unlock.
pub const ROULETTE_SETTLE_HOLD: f64 = 1.4;

/// The wheel's round.
pub struct RouletteDrive {
    t: f64,
    spinning: bool,
    spin: Option<Spin>,
    pocket: i32,
    bet: BetDef,
    stake: i64,
    result: Option<(f64, String)>,
}

impl RouletteDrive {
    pub fn new(bet: BetDef) -> Self {
        Self {
            t: 0.0,
            spinning: false,
            spin: None,
            pocket: 0,
            bet,
            stake: 0,
            result: None,
        }
    }

    pub fn bet(&self) -> &BetDef {
        &self.bet
    }

    /// Change the bet. Refused mid-spin — the wheel is already committed, and
    /// the legacy cabinet routes bet selection through `controls()` rather than
    /// `poke()` precisely because a poke only fires while BUSY.
    pub fn set_bet(&mut self, bet: BetDef) {
        if !self.spinning {
            self.bet = bet;
        }
    }

    pub fn busy(&self) -> bool {
        self.spinning
    }

    pub fn pocket(&self) -> i32 {
        self.pocket
    }

    /// The ball's current frame, for the painter.
    pub fn frame(&self) -> Option<BallFrame> {
        self.spin.as_ref().map(|s| frame_at(s, self.t))
    }

    /// Begin a round. The pocket is decided NOW and the trajectory is PLANNED
    /// to land in it — `plan_spin` searches for a natural path to the chosen
    /// pocket rather than reading a pocket off wherever the ball fell. Same
    /// rule as slots: the animation cannot disagree with the payout.
    pub fn play(&mut self, stake: i64, rand: &mut dyn FnMut() -> f64) {
        if self.spinning {
            return;
        }
        self.t = 0.0;
        self.stake = stake;
        self.pocket = spin_wheel(rand);
        self.spin = Some(plan_spin(self.pocket, rand));
        self.result = Some(settle_bet(&self.bet, self.pocket));
        self.spinning = true;
    }

    pub fn tick(&mut self, dt: f64) -> Option<RoundResult> {
        if !self.spinning {
            return None;
        }
        self.t += dt;
        let dur = self.spin.as_ref().map_or(0.0, |s| s.duration);
        if self.t < dur + ROULETTE_SETTLE_HOLD {
            return None;
        }
        self.spinning = false;
        self.settle()
    }

    pub fn forfeit(&mut self) -> Option<RoundResult> {
        if !self.spinning {
            return None;
        }
        self.spinning = false;
        self.settle()
    }

    fn settle(&self) -> Option<RoundResult> {
        let (mult, label) = self.result.clone()?;
        Some(RoundResult {
            game: GameId::Roulette,
            stake: self.stake,
            payout: (self.stake as f64 * mult).round() as i64,
            label,
        })
    }
}

/// The board's round.
///
/// A THIN wrapper: [`ThrowMachine`] already owns the sweep, the three darts,
/// the `RoundDone` event AND its own `SETTLE_HOLD` back to `Idle`. The first
/// cut of this driver added a second hold on top and would have double-counted
/// it — 1.5s of machine hold plus 1.2s of wrapper hold — so the controls stayed
/// locked for nearly three seconds after the last dart. This adds only what the
/// machine has no business knowing: the stake and the payout.
pub struct DartsDrive<R: FnMut() -> f64> {
    machine: ThrowMachine<R>,
    stake: i64,
    playing: bool,
}

impl<R: FnMut() -> f64> DartsDrive<R> {
    pub fn new(rng: R) -> Self {
        Self {
            machine: ThrowMachine::new(rng),
            stake: 0,
            playing: false,
        }
    }

    pub fn machine(&self) -> &ThrowMachine<R> {
        &self.machine
    }

    pub fn busy(&self) -> bool {
        self.playing
    }

    pub fn play(&mut self, stake: i64) {
        if self.playing {
            return;
        }
        self.stake = stake;
        self.playing = true;
        self.machine.begin(stake as f64);
    }

    /// The primary key during a round: lock the cursor and throw.
    pub fn press(&mut self) -> Vec<ThrowEvent> {
        if !self.playing {
            return Vec::new();
        }
        self.machine.press()
    }

    /// Advance the round. Settles on the machine's OWN `RoundDone` — not on a
    /// phase poll and not on a hold of this driver's own, either of which would
    /// stack a second delay on top of `darts_throw::SETTLE_HOLD`.
    pub fn tick(&mut self, dt: f64) -> (Vec<ThrowEvent>, Option<RoundResult>) {
        if !self.playing {
            return (Vec::new(), None);
        }
        let events = self.machine.tick(dt);
        let done = events
            .iter()
            .any(|e| matches!(e, ThrowEvent::RoundDone { .. }));
        if !done {
            return (events, None);
        }
        self.playing = false;
        (events, self.settle())
    }

    pub fn forfeit(&mut self) -> Option<RoundResult> {
        if !self.playing {
            return None;
        }
        self.playing = false;
        self.settle()
    }

    fn settle(&self) -> Option<RoundResult> {
        let (_total, mult, label) = self.machine.result();
        Some(RoundResult {
            game: GameId::Darts,
            stake: self.stake,
            payout: (self.stake as f64 * mult).round() as i64,
            label: label.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gambler::darts_throw::ThrowPhase;
    use crate::rng::Mulberry32;

    /// ⚠️ THE OUTCOME IS FIXED AT `play`, NOT AT THE END OF THE ANIMATION.
    ///
    /// The single worst bug a slot machine can have is reels that land on one
    /// thing and pay another. Ticking to the end must return exactly what the
    /// spin rolled, and a FORFEIT mid-flight must return the same thing — the
    /// stake was already taken, so a teardown that paid nothing would eat it.
    #[test]
    fn a_slots_round_pays_what_it_rolled_however_it_ends() {
        let mut rng = Mulberry32::new(7);
        let mut a = SlotsDrive::new();
        a.play(10, &mut || rng.next_f64());
        let reels = a.reels().expect("rolled at play");

        // Run it to the end.
        let mut end = None;
        for _ in 0..600 {
            if let Some(r) = a.tick(0.016) {
                end = Some(r);
                break;
            }
        }
        let end = end.expect("the round must finish");

        // The same roll, forfeited one frame in.
        let mut rng = Mulberry32::new(7);
        let mut b = SlotsDrive::new();
        b.play(10, &mut || rng.next_f64());
        assert_eq!(b.reels(), Some(reels), "same seed, same reels");
        b.tick(0.016);
        let forfeit = b.forfeit().expect("a live round owes a settle");

        assert_eq!(end.payout, forfeit.payout);
        assert_eq!(end.label, forfeit.label);
    }

    /// A round that already ended owes nothing — `forfeit` after the settle
    /// must not pay a second time.
    #[test]
    fn a_finished_round_cannot_be_forfeited_for_a_second_payout() {
        let mut rng = Mulberry32::new(3);
        let mut d = SlotsDrive::new();
        d.play(10, &mut || rng.next_f64());
        while d.tick(0.016).is_none() {}
        assert!(d.forfeit().is_none(), "a settled round paid twice");
    }

    /// ⚠️ A POKE PULLS A REEL IN; IT NEVER STOPS ONE ON THE SPOT OR IN THE PAST.
    ///
    /// A stop at or before `t` has already passed its own test, so the drum
    /// would jump rather than land, and a stop exactly at `t` reads as the
    /// machine ignoring the press.
    #[test]
    fn a_poke_pulls_the_next_reel_forward_but_never_past_now() {
        let mut rng = Mulberry32::new(1);
        let mut d = SlotsDrive::new();
        d.play(10, &mut || rng.next_f64());
        d.tick(0.1);
        let before = d.stop_at;
        d.poke();
        assert!(d.stop_at[0] < before[0], "the poke did not pull reel 0 in");
        assert!(
            d.stop_at[0] > 0.1,
            "the poke pulled reel 0 to or before now"
        );
        assert_eq!(d.stop_at[1], before[1], "the poke moved more than one reel");

        // Slam it. Every stop must stay ahead of the clock.
        for _ in 0..50 {
            d.poke();
        }
        assert!(d.stop_at.iter().all(|s| *s > d.t));
    }

    /// ⚠️ THE SCHEDULE IS PER-MACHINE, NOT PER-PROCESS.
    ///
    /// The legacy version wrote through a module-level `const` and relied on
    /// `play()` restoring it. This is the general form of that bug: a poked
    /// machine must not shorten a FRESH one's reels.
    #[test]
    fn poking_one_machine_does_not_shorten_another() {
        let mut rng = Mulberry32::new(1);
        let mut a = SlotsDrive::new();
        a.play(10, &mut || rng.next_f64());
        a.tick(0.1);
        for _ in 0..5 {
            a.poke();
        }
        let mut b = SlotsDrive::new();
        b.play(10, &mut || rng.next_f64());
        assert_eq!(
            b.stop_at, STOP_AT_DEFAULT,
            "a fresh machine inherited a poke"
        );
    }

    /// A second `play` on a spinning machine is ignored — otherwise a double
    /// press takes two stakes for one animation.
    #[test]
    fn play_is_ignored_while_a_round_is_already_running() {
        let mut rng = Mulberry32::new(9);
        let mut d = SlotsDrive::new();
        d.play(10, &mut || rng.next_f64());
        let first = d.reels();
        d.play(50, &mut || rng.next_f64());
        assert_eq!(d.reels(), first, "a second play re-rolled a live round");
    }

    /// The wheel lands in the pocket it decided on, and the bet is settled
    /// against THAT pocket — the payout can never disagree with the ball.
    #[test]
    fn the_wheel_settles_against_the_pocket_it_planned_for() {
        let bets = super::super::roulette::bets();
        let red = bets.iter().find(|b| b.id == "red").expect("a red bet");
        let mut rng = Mulberry32::new(42);
        let mut d = RouletteDrive::new(red.clone());
        d.play(20, &mut || rng.next_f64());
        let planned = d.pocket();

        let mut out = None;
        for _ in 0..4000 {
            if let Some(r) = d.tick(0.016) {
                out = Some(r);
                break;
            }
        }
        let out = out.expect("the wheel must come to rest");
        let (mult, label) = super::super::roulette::settle_bet(red, planned);
        assert_eq!(out.payout, (20.0 * mult).round() as i64);
        assert_eq!(out.label, label);
    }

    /// The bet cannot be changed once the ball is rolling.
    #[test]
    fn a_bet_cannot_be_switched_mid_spin() {
        let bets = super::super::roulette::bets();
        let red = bets.iter().find(|b| b.id == "red").unwrap().clone();
        let black = bets.iter().find(|b| b.id == "black").unwrap().clone();
        let mut rng = Mulberry32::new(5);
        let mut d = RouletteDrive::new(red);
        d.play(10, &mut || rng.next_f64());
        d.set_bet(black);
        assert_eq!(
            d.bet().id,
            "red",
            "the bet changed after the ball was rolling"
        );
    }

    /// Darts runs to `Done` and settles against the machine's own total.
    #[test]
    fn a_darts_round_settles_against_the_total_it_threw() {
        let mut rng = Mulberry32::new(11);
        let mut d = DartsDrive::new(move || rng.next_f64());
        d.play(10);
        let mut out = None;
        for _ in 0..6000 {
            // Press whenever the machine is waiting for one, so the round
            // actually progresses rather than sweeping forever.
            if matches!(d.machine().phase(), ThrowPhase::AimX | ThrowPhase::AimY) {
                d.press();
            }
            let (_ev, r) = d.tick(0.016);
            if let Some(r) = r {
                out = Some(r);
                break;
            }
        }
        let out = out.expect("three darts must land");
        let (_total, mult, label) = d.machine().result();
        assert_eq!(out.payout, (10.0 * mult).round() as i64);
        assert_eq!(out.label, label);
        assert_eq!(out.stake, 10);
    }
}
