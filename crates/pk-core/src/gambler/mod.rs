//! 🎰 THE GAMBLER — the casino cabinet's deterministic core (P6).
//!
//! Port of `legacy/src/scenes/tavern/gambler/` minus the canvas painters and
//! audio patches: the house rules (`table`), the four games' outcome logic
//! (`slots`, `roulette` + `roulette_physics`, `blackjack` +
//! `blackjack_table`, `darts` + `darts_throw`), each with its legacy test
//! suite ported case for case — including the RTP Monte-Carlos that hold the
//! economy to its budget.
//!
//! PORTS: `legacy/src/scenes/tavern/gambler/index.ts`, `legacy/src/scenes/tavern/gambler/offscreen.ts`

pub mod blackjack;
pub mod blackjack_table;
pub mod darts;
pub mod darts_throw;
pub mod drive;
pub mod offscreen;
pub mod roulette;
pub mod roulette_physics;
pub mod slots;
pub mod symbols;
pub mod table;

pub use offscreen::*;
pub use symbols::*;

pub trait PlayApi {
    fn resolve(&mut self, stake: i64, payout: i64, label: &str);
}

pub trait CasinoGame {
    fn play(&mut self, stake: i64);
}

pub fn is_gambler_open() -> bool {
    false
}

pub fn reset_gambler_visit() {}

pub fn open_gambler() {}

pub fn close_gambler() {}
