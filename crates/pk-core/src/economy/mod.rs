//! THE ECONOMY — the tavern's rules, as pure data and pure functions.
//!
//! PORTS: `economy/tavern-shop.ts`, `items.ts`, `economy/shop.ts`, `economy/ground-items.ts`, `armor-styles.ts`, `economy/loot.ts`
//!
//! Track T in `docs/src/status/one-to-one.md` — 1,845 lines and, until this
//! module, **0% ported**, while `pk_core::gambler` next door was complete with
//! 250 tests. The shop is pure data and predicates, so it is the highest ratio
//! of shipped behaviour to ported lines left in the tree.

pub mod alchemist;
pub mod armory;
pub mod coins;
pub mod dealer;
pub mod forge;
pub mod gold_wallet;
pub mod ground_items;
pub mod loot;
pub mod pickups;
pub mod shop;

pub use coins::*;
pub use gold_wallet::*;
pub use ground_items::*;
pub use loot::*;
pub use pickups::*;
pub use shop::*;

/// A purchase's answer — the oracle's `ActionResult`, which is a message to
/// flash or `null` for "nothing happened".
///
/// ⚠️ `None` and `Some("not enough gold")` are DIFFERENT outcomes and the UI
/// paints both: `None` means the action was not applicable at all (no such
/// slot, already owned), and it is the only one that must not charge.
pub type ActionResult = Option<String>;
