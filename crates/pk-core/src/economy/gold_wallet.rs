//! Gold Wallet — Single source of truth for the player's gold currency.
//!
//! PORTS: `legacy/src/utils/gold-wallet.ts`

use serde::{Deserialize, Serialize};

pub const GOLD_WALLET_KEY: &str = "lazycat_gold_wallet";
pub const HISTORY_KEY: &str = "lazycat_gold_history";
pub const SEED_AMOUNT: i64 = 100;
pub const MAX_HISTORY: usize = 20;

/// A single gold transaction record mirroring `legacy/src/utils/gold-wallet.ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransactionRecord {
    pub amount: i64,
    pub source: String,
    pub timestamp: i64,
}

/// Pure wallet state serializable to storage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletState {
    pub balance: i64,
}

/// The player's persistent purse and transaction ledger.
/// `legacy/src/utils/gold-wallet.ts`'s state machine, with raw I/O left to the shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wallet {
    balance: i64,
    history: Vec<TransactionRecord>,
}

impl Default for Wallet {
    fn default() -> Self {
        Self::new(SEED_AMOUNT)
    }
}

impl Wallet {
    pub fn new(balance: i64) -> Self {
        Self {
            balance: balance.max(0),
            history: Vec::new(),
        }
    }

    pub fn state(&self) -> WalletState {
        WalletState {
            balance: self.balance,
        }
    }

    pub fn balance(&self) -> i64 {
        self.balance
    }

    pub fn history(&self) -> &[TransactionRecord] {
        &self.history
    }

    pub fn record_transaction(&mut self, amount: i64, source: &str, timestamp: i64) {
        self.history.push(TransactionRecord {
            amount,
            source: source.to_string(),
            timestamp,
        });
        if self.history.len() > MAX_HISTORY {
            self.history.remove(0);
        }
    }

    /// `addGold` — non-positive amounts are a no-op, and the amount is FLOORED.
    pub fn add(&mut self, amount: i64) -> i64 {
        self.add_with_source(amount, "unspecified", 0)
    }

    /// `addGold` with source tracking and timestamp.
    pub fn add_with_source(&mut self, amount: i64, source: &str, timestamp: i64) -> i64 {
        if amount > 0 {
            self.balance += amount;
            self.record_transaction(amount, source, timestamp);
        }
        self.balance
    }

    /// `spendGold` — true when it was paid for. **A false here must abort the
    /// purchase**: the oracle's `pay()` is the only thing standing between a
    /// broke player and free plate.
    #[must_use]
    pub fn spend(&mut self, amount: i64) -> bool {
        self.spend_with_source(amount, "unspecified", 0)
    }

    /// `spendGold` with source tracking and timestamp.
    #[must_use]
    pub fn spend_with_source(&mut self, amount: i64, source: &str, timestamp: i64) -> bool {
        if amount <= 0 {
            return true;
        }
        if self.balance < amount {
            return false;
        }
        self.balance -= amount;
        self.record_transaction(-amount, source, timestamp);
        true
    }

    /// `resetWallet` — resets balance to SEED_AMOUNT and clears history (debug only).
    pub fn reset(&mut self) {
        self.balance = SEED_AMOUNT;
        self.history.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_zero_or_negative_charge_succeeds_and_takes_nothing() {
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

    #[test]
    fn transaction_history_tracks_and_caps_at_max_history() {
        let mut w = Wallet::new(100);
        for i in 1..=25 {
            w.add_with_source(i, "dungeon_reward", i * 1000);
        }
        assert_eq!(w.history().len(), MAX_HISTORY);
        assert_eq!(w.history().last().unwrap().amount, 25);
    }
}
