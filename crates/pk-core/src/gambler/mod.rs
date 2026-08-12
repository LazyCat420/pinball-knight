//! 🎰 THE GAMBLER — the casino cabinet's deterministic core (P6).
//!
//! Port of `legacy/src/scenes/tavern/gambler/` minus the canvas painters and
//! audio patches: the house rules (`table`), the four games' outcome logic
//! (`slots`, `roulette` + `roulette_physics`, `blackjack` +
//! `blackjack_table`, `darts` + `darts_throw`), each with its legacy test
//! suite ported case for case — including the RTP Monte-Carlos that hold the
//! economy to its budget.
//!
//! The split the legacy shell enforces is preserved: games own only their own
//! outcome; every movement of gold goes through `table` (the `TableDeps` /
//! `BlackjackApi` seams), so the stake caps and the per-visit round limit
//! cannot be bypassed.

pub mod blackjack;
pub mod blackjack_table;
pub mod darts;
pub mod darts_throw;
pub mod drive;
pub mod roulette;
pub mod roulette_physics;
pub mod slots;
pub mod table;
