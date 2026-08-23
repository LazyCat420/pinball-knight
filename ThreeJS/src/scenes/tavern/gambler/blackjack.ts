/**
 * BLACKJACK — "Twenty-One". The thinking game, and the best odds in the house.
 *
 * Rules are deliberately trimmed, and the trimming is a design choice rather
 * than laziness:
 *
 *  - **Single deck, reshuffled every round.** Keeps the game stateless between
 *    rounds and kills card counting, which would otherwise be the one way to
 *    push the RTP over 100% and break the card economy.
 *  - **Dealer stands on ALL 17**, including soft 17. Player-friendly, and the
 *    simpler rule to read off a table.
 *  - **Blackjack pays 3:2.**
 *  - **Hit / Stand / Double only.** No splits, no insurance, no surrender.
 *    Splits need a whole second hand of state and UI for a decision that comes
 *    up rarely; dropping them costs the player ~0.5% and the game half its
 *    complexity. Insurance is a sucker bet that only ever lowers RTP.
 *
 * Together that lands near 98% under decent play — the target for the game that
 * rewards actual decisions.
 *
 * Everything here is pure: a seedable deck, and resolution as data. The RTP is
 * then measurable by simulating basic strategy, which is the only honest way to
 * know the rules are priced where the plan says.
 */

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";

/** 1 = ace, 11..13 = J/Q/K. */
export type Rank = number;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

export const RED_SUITS: Suit[] = ["hearts", "diamonds"];

/** Short label for a rank — what gets drawn in the card's corner. */
export function rankLabel(rank: Rank): string {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return String(rank);
}

/** Blackjack value of a rank. Aces count 11 here; `handValue` demotes them. */
export function cardValue(rank: Rank): number {
  if (rank === 1) return 11;
  return rank >= 10 ? 10 : rank;
}

/** A fresh 52-card deck in order. */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) deck.push({ rank, suit });
  }
  return deck;
}

/** Fisher-Yates. Seedable so a test can replay an exact shoe. */
export function shuffle(deck: Card[], rand: () => number = Math.random): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface HandValue {
  /** Best total that isn't a bust, or the minimum total if every option busts. */
  total: number;
  /** True if an ace is still counted as 11 — i.e. the hand can absorb a hit. */
  soft: boolean;
  bust: boolean;
}

/**
 * Score a hand, demoting aces from 11 to 1 only as far as needed.
 *
 * The "only as far as needed" is the whole subtlety: A+A+9 is 21, not 12 and not
 * 31. Demoting all aces up front, or none, are both wrong.
 */
export function handValue(cards: Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 1) aces++;
  }
  // Each demotion drops 10. Stop as soon as we're under 21.
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces--;
  }
  return { total, soft: softAces > 0, bust: total > 21 };
}

/** A natural: exactly two cards totalling 21. */
export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export type Outcome =
  | "player-blackjack"
  | "player-win"
  | "dealer-win"
  | "push"
  | "player-bust"
  | "dealer-bust";

export interface Settlement {
  outcome: Outcome;
  /** Stake multiplier, stake INCLUDED. 0 = lost, 1 = push, 2 = win, 2.5 = natural. */
  multiplier: number;
  label: string;
}

/** Dealer draws until 17 or more. Stands on all 17, soft included. */
export function dealerShouldHit(cards: Card[]): boolean {
  return handValue(cards).total < 17;
}

/**
 * Settle a finished hand.
 *
 * Order matters: busts first (a bust loses even if the dealer also busts later,
 * which is exactly where the house edge comes from), then naturals, then totals.
 */
export function settleHand(player: Card[], dealer: Card[]): Settlement {
  const p = handValue(player);
  const d = handValue(dealer);

  // The player acts first, so a player bust loses immediately — the dealer never
  // even draws. This asymmetry IS the house edge in blackjack.
  if (p.bust) return { outcome: "player-bust", multiplier: 0, label: `BUST — ${p.total}` };

  const pBJ = isBlackjack(player);
  const dBJ = isBlackjack(dealer);
  if (pBJ && dBJ) return { outcome: "push", multiplier: 1, label: "BOTH BLACKJACK — PUSH" };
  if (pBJ) return { outcome: "player-blackjack", multiplier: 2.5, label: "BLACKJACK!" };
  if (dBJ) return { outcome: "dealer-win", multiplier: 0, label: "DEALER BLACKJACK" };

  if (d.bust) return { outcome: "dealer-bust", multiplier: 2, label: `DEALER BUST — ${d.total}` };
  if (p.total > d.total) return { outcome: "player-win", multiplier: 2, label: `${p.total} BEATS ${d.total}` };
  if (p.total < d.total) return { outcome: "dealer-win", multiplier: 0, label: `${d.total} BEATS ${p.total}` };
  return { outcome: "push", multiplier: 1, label: `PUSH ON ${p.total}` };
}

// ── Basic strategy ────────────────────────────────────────────
// Used by the RTP test, not by the game. Simplified (no splits, since the game
// has none), but close enough that the measured return reflects real play
// rather than a random-button baseline.

export type Move = "hit" | "stand" | "double";

/**
 * What basic strategy says to do.
 *
 * `canDouble` is false after the first decision — you may only double on your
 * opening two cards.
 */
export function basicStrategy(player: Card[], dealerUp: Card, canDouble: boolean): Move {
  const { total, soft } = handValue(player);
  const up = cardValue(dealerUp.rank);
  // Treat the dealer's ace as 11 for the strategy table.
  const dealerStrong = up >= 7 || up === 11;

  if (soft) {
    // Soft hands: an ace absorbing a hit means hitting is much safer.
    if (total >= 19) return "stand";
    if (total === 18) {
      if (canDouble && up >= 3 && up <= 6) return "double";
      return dealerStrong && up !== 7 ? "hit" : "stand";
    }
    if (canDouble && total >= 15 && total <= 17 && up >= 4 && up <= 6) return "double";
    if (canDouble && total >= 13 && total <= 14 && up >= 5 && up <= 6) return "double";
    return "hit";
  }

  // Hard hands.
  if (total >= 17) return "stand";
  if (total >= 13 && total <= 16) return dealerStrong ? "hit" : "stand";
  if (total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
  if (total === 11) return canDouble ? "double" : "hit";
  if (total === 10) return canDouble && up <= 9 ? "double" : "hit";
  if (total === 9) return canDouble && up >= 3 && up <= 6 ? "double" : "hit";
  return "hit";
}

/**
 * Play one full hand under basic strategy and return the stake multiplier.
 *
 * Doubling stakes twice the money, so its return is doubled too — that is what
 * makes the RTP measurement honest rather than flattering.
 */
export function simulateHand(rand: () => number = Math.random): { multiplier: number; wagered: number } {
  const deck = shuffle(freshDeck(), rand);
  let i = 0;
  const draw = (): Card => deck[i++];

  const player: Card[] = [draw(), draw()];
  const dealer: Card[] = [draw(), draw()];

  let wagered = 1;
  let doubled = false;
  let first = true;

  // Naturals resolve before anyone acts.
  if (!isBlackjack(player) && !isBlackjack(dealer)) {
    for (;;) {
      if (handValue(player).bust) break;
      const move = basicStrategy(player, dealer[0], first && !doubled);
      first = false;
      if (move === "stand") break;
      if (move === "double") {
        wagered = 2;
        doubled = true;
        player.push(draw());
        break; // a double takes exactly one card, then stands
      }
      player.push(draw());
    }

    if (!handValue(player).bust) {
      while (dealerShouldHit(dealer)) dealer.push(draw());
    }
  }

  const s = settleHand(player, dealer);
  return { multiplier: s.multiplier * wagered, wagered };
}
