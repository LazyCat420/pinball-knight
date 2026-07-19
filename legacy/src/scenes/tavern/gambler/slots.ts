/**
 * SLOTS — "The One-Armed Bandit".
 *
 * Pure chance and the worst odds in the house: the game you play when you don't
 * want to think. Target RTP ~90%.
 *
 * Tuned with WEIGHTED REEL STRIPS rather than a flat symbol roll. That is how
 * real machines hit a target return, and it buys something a flat roll can't:
 * ★ can be visibly present on every reel — so you watch it slide past and feel
 * the near-miss — while still being rare enough that three of them is a 40×
 * event. A flat roll would have to make ★ literally scarce to be rare, and then
 * you'd never see it at all.
 *
 * Pure and injectable-random, so `slots.test.ts` can Monte-Carlo the real RTP
 * instead of trusting the paytable arithmetic.
 */

export type Symbol = "ball" | "bumper" | "flipper" | "target" | "jackpot" | "skull";

/** Display glyph per symbol — the renderer draws pixel art, this is the label. */
export const SYMBOL_GLYPH: Record<Symbol, string> = {
  ball: "●",
  bumper: "◉",
  flipper: "⌒",
  target: "◆",
  jackpot: "★",
  skull: "☠",
};

export const SYMBOL_NAME: Record<Symbol, string> = {
  ball: "BALL",
  bumper: "BUMPER",
  flipper: "FLIPPER",
  target: "TARGET",
  jackpot: "JACKPOT",
  skull: "SKULL",
};

/**
 * The reel strip — one entry per stop position. All three reels share it.
 *
 * The composition is SOLVED, not guessed. The first attempt looked reasonable
 * (5 skulls, a 40x jackpot) and enumerated to a 13% RTP — the player would have
 * lost 87% of every bet. These counts come from searching the space for ~90%
 * with the paytable below; `exactRtp()` enumerates all 4096 combinations and
 * the test asserts the band, so any future edit to either has to re-earn it.
 *
 * `jackpot` appears exactly once, so P(★★★) = (1/16)³ ≈ 1/4096 — but it is
 * visibly present on every reel, so you watch it slide past and feel the near
 * miss. Making it rare by making it *absent* would remove the tension entirely.
 */
export const REEL_STRIP: Symbol[] = [
  "skull",
  "ball",
  "bumper",
  "flipper",
  "ball",
  "bumper",
  "skull",
  "ball",
  "flipper",
  "bumper",
  "ball",
  "target",
  "flipper",
  "ball",
  "bumper",
  "jackpot",
];

/**
 * Multiplier on the stake for three of a kind, stake included.
 *
 * Kept modest on purpose. The obvious way to raise RTP is bigger multipliers,
 * but max stake is 100g and a mythic card costs 600g — a 40x top prize pays
 * 4000g and would wreck the card economy far more thoroughly than a bad RTP.
 * The return is bought with FREQUENT small wins instead (see ANY_PAIR_PAY),
 * which is also how a slot machine is supposed to feel.
 */
export const PAYTABLE: Record<Symbol, number> = {
  jackpot: 25,
  target: 14,
  flipper: 10,
  bumper: 6,
  ball: 4,
  skull: 0, // three skulls pays nothing — the joke, and part of the tax
};

/** Two jackpots anywhere on the line — the consolation for a near miss. */
export const TWO_JACKPOT_PAY = 3;

/**
 * Any two matching symbols pays this.
 *
 * Carries roughly half the total RTP on its own. Without it the three-of-a-kind
 * multipliers would have to be enormous to reach 90%, and most spins would
 * return nothing — which is the difference between a slot machine and a tax.
 */
export const ANY_PAIR_PAY = 1.2;

export interface SpinOutcome {
  reels: [Symbol, Symbol, Symbol];
  /** Multiplier applied to the stake. 0 = lost, 1 = push. */
  multiplier: number;
  label: string;
}

/** Spin three reels off the strip. */
export function spin(rand: () => number = Math.random): SpinOutcome {
  const pick = (): Symbol => REEL_STRIP[Math.floor(rand() * REEL_STRIP.length)];
  const reels: [Symbol, Symbol, Symbol] = [pick(), pick(), pick()];
  return { reels, ...score(reels) };
}

/** Score a line. Separated from `spin` so tests can score exact reel sets. */
export function score(reels: [Symbol, Symbol, Symbol]): { multiplier: number; label: string } {
  const [a, b, c] = reels;

  if (a === b && b === c) {
    const mult = PAYTABLE[a];
    if (mult === 0) return { multiplier: 0, label: "THREE SKULLS — NOTHING" };
    return { multiplier: mult, label: `THREE ${SYMBOL_NAME[a]}S` };
  }

  // Two jackpots is the consolation that keeps a near miss from feeling empty.
  const jackpots = reels.filter((s) => s === "jackpot").length;
  if (jackpots === 2) return { multiplier: TWO_JACKPOT_PAY, label: "TWO JACKPOTS" };

  // Any pair — small, frequent, and where most of the return actually lives.
  if (a === b || b === c || a === c) {
    const pairSym = a === b || a === c ? a : b;
    return { multiplier: ANY_PAIR_PAY, label: `PAIR OF ${SYMBOL_NAME[pairSym]}S` };
  }

  return { multiplier: 0, label: "NO LINE" };
}

/**
 * Exact RTP of the current strip and paytable, by full enumeration.
 *
 * 16³ = 4096 combinations, so this is computable rather than estimated — the
 * Monte-Carlo test then confirms the sampler agrees with the maths. If a
 * paytable edit pushes this over 1.0 the house loses money on average, which
 * would make the slot machine the optimal way to buy cards.
 */
export function exactRtp(): number {
  const n = REEL_STRIP.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        total += score([REEL_STRIP[i], REEL_STRIP[j], REEL_STRIP[k]]).multiplier;
      }
    }
  }
  return total / (n * n * n);
}
