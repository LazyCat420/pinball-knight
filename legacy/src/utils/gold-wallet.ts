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

/**
 * Ensure the wallet exists in localStorage. Seeds with 100 gold if missing.
 * @returns {{ balance: number }}
 */
function _loadWallet() {
  const raw = localStorage.getItem(GOLD_WALLET_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.balance === "number") return parsed;
    } catch (_e) {
      // Corrupted — reset
    }
  }
  // Seed new wallet
  const wallet = { balance: SEED_AMOUNT };
  localStorage.setItem(GOLD_WALLET_KEY, JSON.stringify(wallet));
  return wallet;
}

/**
 * Save wallet state to localStorage.
 * @param {{ balance: number }} wallet
 */
function _saveWallet(wallet) {
  wallet.balance = Math.max(0, Math.floor(wallet.balance));
  localStorage.setItem(GOLD_WALLET_KEY, JSON.stringify(wallet));
}

/**
 * Load transaction history from localStorage.
 * @returns {Array<{ amount: number, source: string, timestamp: number }>}
 */
function _loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_e) {
    // Corrupted — reset
  }
  return [];
}

/**
 * Save transaction history to localStorage.
 * @param {Array} history
 */
function _saveHistory(history) {
  // Keep only the last MAX_HISTORY entries
  const trimmed = history.slice(-MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

/**
 * Get the current gold balance.
 * @returns {number}
 */
export function getBalance() {
  return _loadWallet().balance;
}

/**
 * Add gold to the wallet.
 * @param {number} amount — positive integer
 * @param {string} source — e.g. "raccoon-tornado", "pirate-chest"
 * @returns {number} new balance
 */
export function addGold(amount, source) {
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
 * @param {number} amount — positive integer
 * @returns {boolean} true if successful, false if insufficient balance
 */
export function spendGold(amount) {
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
 * @returns {Array<{ amount: number, source: string, timestamp: number }>}
 */
export function getHistory() {
  return _loadHistory();
}

/**
 * Reset the wallet — dev/debug only.
 */
export function resetWallet() {
  localStorage.removeItem(GOLD_WALLET_KEY);
  localStorage.removeItem(HISTORY_KEY);
}
