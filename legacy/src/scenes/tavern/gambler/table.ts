/**
 * THE TABLE — the house rules every game at the gambler goes through.
 *
 * Stake limits, the per-visit round limit, and the only code allowed to move
 * gold. No game touches the wallet directly: routing everything through here is
 * what makes the caps and the round limit impossible to bypass, and it means
 * "did the player actually get paid" is testable in one place instead of four.
 *
 * Pure except for the wallet calls, which are injected — so the whole ruleset
 * can be exercised without a browser or a real purse.
 */

/** Which game a round belongs to. Used for the round log and telemetry. */
export type GameId = "slots" | "roulette" | "blackjack" | "darts";

/**
 * Rounds allowed per tavern visit.
 *
 * Not flavour — a hard economic necessity. The tavern is entered once per floor,
 * so without a cap any game a player can get GOOD at (darts especially, and
 * blackjack under basic strategy) becomes an unlimited gold faucet, and the shop
 * and boss-drop economies stop mattering.
 */
export const ROUNDS_PER_VISIT = 6;

/** Smallest bet. Below this the drama isn't worth the click. */
export const MIN_STAKE = 5;

/** Hard ceiling regardless of purse — stops a deep run trivialising the shop. */
export const MAX_STAKE_ABS = 100;

/**
 * The largest legal stake for a given purse.
 *
 * Half the purse, capped at MAX_STAKE_ABS. The fraction stops a floor-1 player
 * with 40g nuking their entire run on one pull; the flat cap stops a floor-10
 * player with 900g buying a mythic through the slot machine.
 *
 * Returns 0 when the purse can't cover the minimum — callers should show the
 * table as closed rather than offering an illegal bet.
 */
export function maxStake(purse: number): number {
  if (purse < MIN_STAKE) return 0;
  return Math.max(MIN_STAKE, Math.min(MAX_STAKE_ABS, Math.floor(purse / 2)));
}

/** Clamp a requested stake into the legal band for this purse. */
export function clampStake(requested: number, purse: number): number {
  const hi = maxStake(purse);
  if (hi === 0) return 0;
  return Math.max(MIN_STAKE, Math.min(hi, Math.floor(requested)));
}

/** The stake steps the UI offers, filtered to what this purse allows. */
export function stakeOptions(purse: number): number[] {
  const hi = maxStake(purse);
  return [5, 10, 25, 50, 100].filter((s) => s >= MIN_STAKE && s <= hi);
}

export interface RoundResult {
  game: GameId;
  stake: number;
  /**
   * Total returned to the player, INCLUDING the stake.
   *
   * So 0 = lost the bet, `stake` = pushed, `stake * 3` = a 3× win. Expressing it
   * as a return rather than a profit is what makes an RTP test read directly:
   * mean(payout) / mean(stake) IS the return-to-player.
   */
  payout: number;
  /** Player-facing one-liner: "THREE BUMPERS", "DEALER BUST", "BUST — 12". */
  label: string;
}

export interface TableDeps {
  getBalance(): number;
  spendGold(amount: number): boolean;
  addGold(amount: number, source: string): number;
}

export interface TableState {
  /** Rounds played this visit. */
  roundsPlayed: number;
  /** Net gold across this visit — what the player sees as "up 40" / "down 25". */
  net: number;
  /** Most recent results, newest last. Capped; purely for the UI ticker. */
  log: RoundResult[];
}

export function createTableState(): TableState {
  return { roundsPlayed: 0, net: 0, log: [] };
}

/** Oldest entries dropped beyond this — the ticker only shows a few. */
const LOG_CAP = 8;

export type BetRejection = "closed" | "too-poor" | "bad-stake";

export interface BetCheck {
  ok: boolean;
  reason?: BetRejection;
  /** Human-readable, ready to show. */
  message?: string;
}

/** Can the player bet `stake` right now? */
export function canBet(table: TableState, purse: number, stake: number): BetCheck {
  if (table.roundsPlayed >= ROUNDS_PER_VISIT) {
    return { ok: false, reason: "closed", message: "THAT'S ENOUGH FROM YOU TONIGHT" };
  }
  if (purse < MIN_STAKE) {
    return { ok: false, reason: "too-poor", message: `YOU NEED AT LEAST ${MIN_STAKE}g` };
  }
  if (stake < MIN_STAKE || stake > maxStake(purse) || !Number.isFinite(stake)) {
    return { ok: false, reason: "bad-stake", message: `TABLE LIMIT: ${MIN_STAKE}–${maxStake(purse)}g` };
  }
  return { ok: true };
}

/** Rounds left before the gambler waves you off. */
export function roundsLeft(table: TableState): number {
  return Math.max(0, ROUNDS_PER_VISIT - table.roundsPlayed);
}

/**
 * Take the stake off the player. Call BEFORE the game resolves.
 *
 * Deliberately two-phase (take, then settle) rather than one net transfer: the
 * player must see the gold leave when they commit, or a loss doesn't land —
 * a purse that simply fails to grow reads as nothing happening.
 */
export function placeBet(table: TableState, deps: TableDeps, stake: number): BetCheck {
  const purse = deps.getBalance();
  const check = canBet(table, purse, stake);
  if (!check.ok) return check;
  if (!deps.spendGold(stake)) {
    return { ok: false, reason: "too-poor", message: "NOT ENOUGH GOLD" };
  }
  return { ok: true };
}

/**
 * Pay out a resolved round and record it. Call AFTER the game resolves.
 *
 * `payout` includes the stake, so a push returns exactly what was taken. Only
 * counts the round once, here, so a game that resolves twice can't burn two
 * rounds off the limit — or, worse, pay twice.
 */
export function settle(table: TableState, deps: TableDeps, result: RoundResult): void {
  table.roundsPlayed += 1;
  table.net += result.payout - result.stake;
  if (result.payout > 0) {
    deps.addGold(result.payout, `gambler:${result.game}`);
  }
  table.log.push(result);
  if (table.log.length > LOG_CAP) table.log.shift();
}

/**
 * Return-to-player over a sample of rounds.
 *
 * The tuning check for the chance games: an RTP above 1 means the house loses
 * money on average, which would make gambling the optimal way to buy cards and
 * gut both the shop and the boss-drop economy. Used by the Monte-Carlo tests.
 */
export function rtp(results: RoundResult[]): number {
  let staked = 0;
  let returned = 0;
  for (const r of results) {
    staked += r.stake;
    returned += r.payout;
  }
  return staked === 0 ? 0 : returned / staked;
}
