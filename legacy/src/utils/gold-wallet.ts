/**
 * Gold Wallet — Single source of truth for the player's gold currency.
 *
 * This is the ONLY file that touches localStorage for gold.
 * All reads/writes are synchronous localStorage.
 *
 * Exports:
 *   getBalance()           → current gold (number)
 *   addGold(amount, source) → adds gold, records transaction
 *   spendGold(amount)      → deducts gold, returns false if insufficient
 *   getHistory()           → last 20 transactions
 *   resetWallet()          → dev/debug only
 *   GOLD_WALLET_KEY        → the localStorage key (no other file should hardcode it)
 */

export const GOLD_WALLET_KEY = "lazycat_gold_wallet";
const HISTORY_KEY = "lazycat_gold_history";
const SEED_AMOUNT = 100;
const MAX_HISTORY = 20;

export interface WalletState {
  balance: number;
}

export interface TransactionRecord {
  amount: number;
  source: string;
  timestamp: number;
}

/**
 * Ensure the wallet exists in localStorage. Seeds with 100 gold if missing.
 */
function _loadWallet(): WalletState {
  if (typeof window === "undefined") {
    return { balance: SEED_AMOUNT };
  }
  const rawWallet = localStorage.getItem(GOLD_WALLET_KEY);
  if (rawWallet !== null) {
    try {
      const parsedWallet = JSON.parse(rawWallet);
      if (typeof parsedWallet.balance === "number") {
        return parsedWallet as WalletState;
      }
    } catch (error: unknown) {
      // Corrupted — reset
    }
  }
  // Seed new wallet
  const wallet: WalletState = { balance: SEED_AMOUNT };
  localStorage.setItem(GOLD_WALLET_KEY, JSON.stringify(wallet));
  return wallet;
}

/**
 * Save wallet state to localStorage.
 */
function _saveWallet(wallet: WalletState): void {
  if (typeof window === "undefined") return;
  wallet.balance = Math.max(0, Math.floor(wallet.balance));
  localStorage.setItem(GOLD_WALLET_KEY, JSON.stringify(wallet));
}

/**
 * Load transaction history from localStorage.
 */
function _loadHistory(): TransactionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const rawHistory = localStorage.getItem(HISTORY_KEY);
    if (rawHistory) {
      return JSON.parse(rawHistory) as TransactionRecord[];
    }
  } catch (error: unknown) {
    // Corrupted — reset
  }
  return [];
}

/**
 * Save transaction history to localStorage.
 */
function _saveHistory(history: TransactionRecord[]): void {
  if (typeof window === "undefined") return;
  // Keep only the last MAX_HISTORY entries
  const trimmedHistory = history.slice(-MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmedHistory));
}

/**
 * Get the current gold balance.
 */
export function getBalance(): number {
  return _loadWallet().balance;
}

/**
 * Add gold to the wallet.
 */
export function addGold(amount: number, source: string): number {
  if (!amount || amount <= 0) return getBalance();
  const wallet = _loadWallet();
  wallet.balance += Math.floor(amount);
  _saveWallet(wallet);

  // Record transaction
  const history = _loadHistory();
  history.push({
    amount: Math.floor(amount),
    source: source || "unknown",
    timestamp: Date.now(),
  });
  _saveHistory(history);

  return wallet.balance;
}

/**
 * Spend gold from the wallet.
 */
export function spendGold(amount: number): boolean {
  if (!amount || amount <= 0) return true;
  const wallet = _loadWallet();
  if (wallet.balance < Math.floor(amount)) return false;

  wallet.balance -= Math.floor(amount);
  _saveWallet(wallet);

  // Record negative transaction
  const history = _loadHistory();
  history.push({
    amount: -Math.floor(amount),
    source: "spent",
    timestamp: Date.now(),
  });
  _saveHistory(history);

  return true;
}

/**
 * Get the last 20 transactions.
 */
export function getHistory(): TransactionRecord[] {
  return _loadHistory();
}

/**
 * Reset the wallet — dev/debug only.
 */
export function resetWallet(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GOLD_WALLET_KEY);
  localStorage.removeItem(HISTORY_KEY);
}
