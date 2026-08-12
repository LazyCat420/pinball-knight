//! THE ECONOMY — the tavern's rules, as pure data and pure functions.
//!
//! PORTS: `economy/tavern-shop.ts`, `items.ts` (gear), `armor-styles.ts`,
//! `utils/gold-wallet.ts`.
//!
//! Track T in `docs/src/status/one-to-one.md` — 1,845 lines and, until this
//! module, **0% ported**, while `pk_core::gambler` next door was complete with
//! 250 tests. The shop is pure data and predicates, so it is the highest ratio
//! of shipped behaviour to ported lines left in the tree.
//!
//! ## Why the wallet lives here and not in the shell
//!
//! The oracle's wallet is `localStorage` behind `getBalance`/`spendGold`
//! (`utils/gold-wallet.ts`), and its persistence is a *shell* concern — native
//! writes a file, wasm writes `localStorage`. What is NOT a shell concern is
//! the ARITHMETIC: `spendGold` floors the amount, refuses when the balance is
//! short, and returns a boolean the caller must honour. Every purchase in the
//! game is gated on that boolean, so it is modelled here as a plain struct the
//! shell loads and saves, and the rules below are total functions over it.

pub mod alchemist;
pub mod armory;
pub mod forge;

/// A purchase's answer — the oracle's `ActionResult`, which is a message to
/// flash or `null` for "nothing happened".
///
/// ⚠️ `None` and `Some("not enough gold")` are DIFFERENT outcomes and the UI
/// paints both: `None` means the action was not applicable at all (no such
/// slot, already owned), and it is the only one that must not charge.
pub type ActionResult = Option<String>;

/// The player's persistent purse. `utils/gold-wallet.ts`'s balance, with the
/// storage left to the shell.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Wallet {
    balance: i64,
}

impl Wallet {
    pub fn new(balance: i64) -> Self {
        Self {
            balance: balance.max(0),
        }
    }

    pub fn balance(&self) -> i64 {
        self.balance
    }

    /// `addGold` — non-positive amounts are a no-op, and the amount is FLOORED.
    pub fn add(&mut self, amount: i64) -> i64 {
        if amount > 0 {
            self.balance += amount;
        }
        self.balance
    }

    /// `spendGold` — true when it was paid for. **A false here must abort the
    /// purchase**: the oracle's `pay()` is the only thing standing between a
    /// broke player and free plate.
    #[must_use]
    pub fn spend(&mut self, amount: i64) -> bool {
        if amount <= 0 {
            return true;
        }
        if self.balance < amount {
            return false;
        }
        self.balance -= amount;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zero_or_negative_charge_succeeds_and_takes_nothing() {
        // `spendGold` returns TRUE for amount <= 0 without touching the
        // balance. A free item must not be refused, and a negative price must
        // not pay the player.
        let mut w = Wallet::new(10);
        assert!(w.spend(0));
        assert!(w.spend(-50));
        assert_eq!(w.balance(), 10);
    }

    #[test]
    fn spending_exactly_the_balance_is_allowed_and_one_more_is_not() {
        let mut w = Wallet::new(45);
        assert!(!w.spend(46), "46 out of 45 must fail");
        assert_eq!(w.balance(), 45, "a refused charge must not deduct");
        assert!(w.spend(45));
        assert_eq!(w.balance(), 0);
    }

    #[test]
    fn a_negative_opening_balance_clamps_rather_than_owing() {
        assert_eq!(Wallet::new(-100).balance(), 0);
    }
}
