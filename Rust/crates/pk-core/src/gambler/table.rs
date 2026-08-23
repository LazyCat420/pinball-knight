//! THE TABLE — the house rules every game at the gambler goes through.
//! Port of `legacy/src/scenes/tavern/gambler/table.ts`.
//!
//! Stake limits, the per-visit round limit, and the only code allowed to move
//! gold. No game touches the wallet directly: routing everything through here
//! is what makes the caps and the round limit impossible to bypass.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/table.ts`

/// Which game a round belongs to. Used for the round log and telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameId {
    Slots,
    Roulette,
    Blackjack,
    Darts,
}

/// Rounds allowed per tavern visit — a hard economic necessity, not flavour.
pub const ROUNDS_PER_VISIT: u32 = 6;

/// Smallest bet. Below this the drama isn't worth the click.
pub const MIN_STAKE: i64 = 5;

/// Hard ceiling regardless of purse — stops a deep run trivialising the shop.
pub const MAX_STAKE_ABS: i64 = 100;

fn clamp(v: i64, lo: i64, hi: i64) -> i64 {
    v.max(lo).min(hi)
}

/// The largest legal stake for a given purse: half the purse, capped at
/// MAX_STAKE_ABS, floored at MIN_STAKE. 0 when the purse can't cover the
/// minimum — callers show the table as closed rather than an illegal bet.
pub fn max_stake(purse: i64) -> i64 {
    if purse < MIN_STAKE {
        return 0;
    }
    clamp(purse / 2, MIN_STAKE, MAX_STAKE_ABS)
}

/// Clamp a requested stake into the legal band for this purse.
/// (Legacy floors the request — stakes are integers here already.)
pub fn clamp_stake(requested: f64, purse: i64) -> i64 {
    let hi = max_stake(purse);
    if hi == 0 {
        return 0;
    }
    clamp(requested.floor() as i64, MIN_STAKE, hi)
}

/// The stake steps the UI offers, filtered to what this purse allows.
pub fn stake_options(purse: i64) -> Vec<i64> {
    let hi = max_stake(purse);
    [5, 10, 25, 50, 100]
        .into_iter()
        .filter(|s| *s >= MIN_STAKE && *s <= hi)
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct RoundResult {
    pub game: GameId,
    pub stake: i64,
    /// Total returned to the player, INCLUDING the stake. 0 = lost,
    /// `stake` = pushed, `stake * 3` = a 3× win — mean(payout)/mean(stake)
    /// IS the return-to-player.
    pub payout: i64,
    /// Player-facing one-liner: "THREE BUMPERS", "DEALER BUST", "BUST — 12".
    pub label: String,
}

/// The wallet seam, injected — so the whole ruleset tests without a purse.
pub trait TableDeps {
    fn get_balance(&self) -> i64;
    fn spend_gold(&mut self, amount: i64) -> bool;
    fn add_gold(&mut self, amount: i64, source: &str) -> i64;
}

#[derive(Debug, Clone, Default)]
pub struct TableState {
    /// Rounds played this visit.
    pub rounds_played: u32,
    /// Net gold across this visit — "up 40" / "down 25".
    pub net: i64,
    /// Most recent results, newest last. Capped; purely for the UI ticker.
    pub log: Vec<RoundResult>,
}

pub fn create_table_state() -> TableState {
    TableState::default()
}

/// Oldest entries dropped beyond this — the ticker only shows a few.
const LOG_CAP: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BetRejection {
    Closed,
    TooPoor,
    BadStake,
}

#[derive(Debug, Clone)]
pub struct BetCheck {
    pub ok: bool,
    pub reason: Option<BetRejection>,
    /// Human-readable, ready to show.
    pub message: Option<String>,
}

impl BetCheck {
    fn ok() -> Self {
        Self {
            ok: true,
            reason: None,
            message: None,
        }
    }
    fn no(reason: BetRejection, message: String) -> Self {
        Self {
            ok: false,
            reason: Some(reason),
            message: Some(message),
        }
    }
}

/// Can the player bet `stake` right now? `stake` is f64 so the nonsense-stake
/// refusals (NaN/Infinity/negative) mirror the legacy checks exactly.
pub fn can_bet(table: &TableState, purse: i64, stake: f64) -> BetCheck {
    if table.rounds_played >= ROUNDS_PER_VISIT {
        return BetCheck::no(
            BetRejection::Closed,
            "THAT'S ENOUGH FROM YOU TONIGHT".into(),
        );
    }
    if purse < MIN_STAKE {
        return BetCheck::no(
            BetRejection::TooPoor,
            format!("YOU NEED AT LEAST {MIN_STAKE}g"),
        );
    }
    if !(stake.is_finite()) || (stake as i64) < MIN_STAKE || (stake as i64) > max_stake(purse) {
        return BetCheck::no(
            BetRejection::BadStake,
            format!("TABLE LIMIT: {MIN_STAKE}–{}g", max_stake(purse)),
        );
    }
    BetCheck::ok()
}

/// Rounds left before the gambler waves you off.
pub fn rounds_left(table: &TableState) -> u32 {
    ROUNDS_PER_VISIT.saturating_sub(table.rounds_played)
}

/// Take the stake off the player. Call BEFORE the game resolves — the player
/// must see the gold leave when they commit.
pub fn place_bet(table: &TableState, deps: &mut dyn TableDeps, stake: i64) -> BetCheck {
    let purse = deps.get_balance();
    let check = can_bet(table, purse, stake as f64);
    if !check.ok {
        return check;
    }
    if !deps.spend_gold(stake) {
        return BetCheck::no(BetRejection::TooPoor, "NOT ENOUGH GOLD".into());
    }
    BetCheck::ok()
}

/// Take an ADDITIONAL wager mid-round (blackjack's double-down). Must NOT
/// consume another round off the visit limit — a double is one hand, not two.
pub fn raise_bet(deps: &mut dyn TableDeps, extra: i64) -> bool {
    if !can_raise(deps, extra) {
        return false;
    }
    deps.spend_gold(extra)
}

/// Could a raise of `extra` go through right now? Asks, without taking
/// anything — so a game can GREY OUT an unaffordable action instead of
/// offering it and silently swallowing the click.
pub fn can_raise(deps: &dyn TableDeps, extra: i64) -> bool {
    if extra <= 0 {
        return false;
    }
    deps.get_balance() >= extra
}

/// Pay out a resolved round and record it. Only counts the round once, here,
/// so a game that resolves twice can't burn two rounds — or pay twice.
pub fn settle(table: &mut TableState, deps: &mut dyn TableDeps, result: RoundResult) {
    table.rounds_played += 1;
    table.net += result.payout - result.stake;
    if result.payout > 0 {
        let source = match result.game {
            GameId::Slots => "gambler:slots",
            GameId::Roulette => "gambler:roulette",
            GameId::Blackjack => "gambler:blackjack",
            GameId::Darts => "gambler:darts",
        };
        deps.add_gold(result.payout, source);
    }
    table.log.push(result);
    if table.log.len() > LOG_CAP {
        table.log.remove(0);
    }
}

/// Return-to-player over a sample of rounds — the tuning check for the chance
/// games. Above 1 the house loses money on average.
pub fn rtp(results: &[RoundResult]) -> f64 {
    let mut staked = 0i64;
    let mut returned = 0i64;
    for r in results {
        staked += r.stake;
        returned += r.payout;
    }
    if staked == 0 {
        0.0
    } else {
        returned as f64 / staked as f64
    }
}

#[cfg(test)]
mod tests {
    //! Ported from `legacy/src/scenes/tavern/gambler/table.test.ts`.
    use super::*;

    /// A fake purse, so the rules can be tested without a real wallet.
    struct FakeWallet {
        balance: i64,
    }
    impl TableDeps for FakeWallet {
        fn get_balance(&self) -> i64 {
            self.balance
        }
        fn spend_gold(&mut self, n: i64) -> bool {
            if self.balance < n {
                return false;
            }
            self.balance -= n;
            true
        }
        fn add_gold(&mut self, n: i64, _source: &str) -> i64 {
            self.balance += n;
            self.balance
        }
    }

    fn result(stake: i64, payout: i64) -> RoundResult {
        RoundResult {
            game: GameId::Slots,
            stake,
            payout,
            label: "TEST".into(),
        }
    }

    #[test]
    fn caps_at_half_the_purse_so_one_pull_cant_nuke_a_run() {
        assert_eq!(max_stake(40), 20);
    }

    #[test]
    fn caps_absolutely_so_a_deep_run_cant_trivialise_the_shop() {
        assert_eq!(max_stake(9000), MAX_STAKE_ABS);
    }

    #[test]
    fn reports_0_for_a_purse_that_cant_cover_the_minimum() {
        assert_eq!(max_stake(MIN_STAKE - 1), 0);
    }

    #[test]
    fn never_returns_a_max_below_the_minimum_for_a_playable_purse() {
        assert_eq!(max_stake(MIN_STAKE), MIN_STAKE);
    }

    #[test]
    fn clamps_a_requested_stake_into_the_legal_band() {
        assert_eq!(clamp_stake(999.0, 40), 20);
        assert_eq!(clamp_stake(1.0, 40), MIN_STAKE);
        assert_eq!(clamp_stake(12.7, 400), 12);
    }

    #[test]
    fn only_offers_stake_steps_the_purse_can_actually_cover() {
        assert_eq!(stake_options(40), vec![5, 10]);
        assert_eq!(stake_options(1000), vec![5, 10, 25, 50, 100]);
        assert!(stake_options(2).is_empty());
    }

    #[test]
    fn allows_a_legal_bet() {
        assert!(can_bet(&create_table_state(), 100, 25.0).ok);
    }

    #[test]
    fn refuses_once_the_visits_rounds_are_used_up() {
        let mut t = create_table_state();
        t.rounds_played = ROUNDS_PER_VISIT;
        let c = can_bet(&t, 100, 10.0);
        assert!(!c.ok);
        assert_eq!(c.reason, Some(BetRejection::Closed));
    }

    #[test]
    fn refuses_a_purse_under_the_minimum() {
        assert_eq!(
            can_bet(&create_table_state(), 2, 5.0).reason,
            Some(BetRejection::TooPoor)
        );
    }

    #[test]
    fn refuses_a_stake_over_the_table_limit() {
        assert_eq!(
            can_bet(&create_table_state(), 40, 30.0).reason,
            Some(BetRejection::BadStake)
        );
    }

    #[test]
    fn refuses_nonsense_stakes() {
        assert!(!can_bet(&create_table_state(), 100, f64::NAN).ok);
        assert!(!can_bet(&create_table_state(), 100, f64::INFINITY).ok);
        assert!(!can_bet(&create_table_state(), 100, -10.0).ok);
    }

    #[test]
    fn takes_the_stake_up_front_so_a_loss_is_visible() {
        let mut w = FakeWallet { balance: 100 };
        let t = create_table_state();
        assert!(place_bet(&t, &mut w, 25).ok);
        assert_eq!(w.balance, 75);
    }

    #[test]
    fn a_loss_returns_nothing() {
        let mut w = FakeWallet { balance: 100 };
        let mut t = create_table_state();
        place_bet(&t, &mut w, 25);
        settle(&mut t, &mut w, result(25, 0));
        assert_eq!(w.balance, 75);
        assert_eq!(t.net, -25);
    }

    #[test]
    fn a_push_returns_exactly_the_stake() {
        let mut w = FakeWallet { balance: 100 };
        let mut t = create_table_state();
        place_bet(&t, &mut w, 25);
        settle(&mut t, &mut w, result(25, 25));
        assert_eq!(w.balance, 100);
        assert_eq!(t.net, 0);
    }

    #[test]
    fn payout_includes_the_stake_a_3x_win_nets_2x() {
        let mut w = FakeWallet { balance: 100 };
        let mut t = create_table_state();
        place_bet(&t, &mut w, 25);
        settle(&mut t, &mut w, result(25, 75));
        assert_eq!(w.balance, 150); // 100 - 25 + 75
        assert_eq!(t.net, 50);
    }

    #[test]
    fn counts_exactly_one_round_per_settle() {
        let mut w = FakeWallet { balance: 500 };
        let mut t = create_table_state();
        place_bet(&t, &mut w, 10);
        settle(&mut t, &mut w, result(10, 0));
        assert_eq!(t.rounds_played, 1);
        assert_eq!(rounds_left(&t), ROUNDS_PER_VISIT - 1);
    }

    #[test]
    fn the_round_limit_actually_stops_play_no_infinite_faucet() {
        let mut w = FakeWallet { balance: 10000 };
        let mut t = create_table_state();
        let mut placed = 0;
        for _ in 0..50 {
            if !place_bet(&t, &mut w, 10).ok {
                break;
            }
            placed += 1;
            settle(&mut t, &mut w, result(10, 40)); // always winning
        }
        assert_eq!(placed, ROUNDS_PER_VISIT);
        assert_eq!(rounds_left(&t), 0);
    }

    #[test]
    fn refuses_to_place_a_bet_the_purse_cannot_cover() {
        let mut w = FakeWallet { balance: 8 };
        let t = create_table_state();
        // 8g purse -> max stake 5. Ask for 5, which is legal, then again broke.
        assert!(place_bet(&t, &mut w, 5).ok);
        assert_eq!(w.balance, 3);
        assert!(!place_bet(&t, &mut w, 5).ok);
    }

    #[test]
    fn keeps_the_log_bounded() {
        let mut w = FakeWallet { balance: 100000 };
        let mut t = create_table_state();
        for _ in 0..30 {
            settle(&mut t, &mut w, result(10, 0));
        }
        assert!(t.log.len() <= 8);
    }

    #[test]
    fn rtp_is_1_when_every_round_pushes() {
        assert_eq!(rtp(&[result(10, 10), result(20, 20)]), 1.0);
    }

    #[test]
    fn rtp_is_0_when_every_round_loses() {
        assert_eq!(rtp(&[result(10, 0)]), 0.0);
    }

    #[test]
    fn rtp_weights_by_stake_not_by_round_count() {
        let r = rtp(&[result(100, 0), result(10, 20)]);
        assert!((r - 20.0 / 110.0).abs() < 1e-5);
    }

    #[test]
    fn rtp_returns_0_rather_than_nan_for_an_empty_sample() {
        assert_eq!(rtp(&[]), 0.0);
    }
}
