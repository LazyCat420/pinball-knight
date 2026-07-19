/**
 * ROULETTE — "The Orbit Wheel".
 *
 * Chance, but you pick your risk. Themed as a pinball ORBIT: the ball rides the
 * outer rail, bleeds speed, and drops into a pocket.
 *
 * WHEEL SIZE IS DERIVED, NOT PICKED. A real 37-pocket wheel is unreadable at
 * this scale, so the question was how small it could get. For a single-zero
 * wheel with N numbered pockets every fairly-priced bet returns N/(N+1):
 *
 *     0+1..12  ->  92.3%  (7.7% edge — too steep)
 *     0+1..18  ->  94.7%  (5.3% edge — the target, and real roulette's number)
 *     0+1..36  ->  97.3%  (the actual casino wheel)
 *
 * So 19 pockets: 0 plus 1–18. That lands on the same 5.26% house edge a real
 * single-zero table has, while staying legible as a ring of chunky pixels.
 *
 * Every bet type carries the SAME edge, which is the correct roulette property:
 * the choice is about variance, not value. A single number is a rare 18× and a
 * colour is a coin flip, but both bleed at 5.26% over time.
 */

/** Numbered pockets, not counting the zero. */
export const WHEEL_NUMBERS = 18;

/** Total pockets including 0. */
export const POCKETS = WHEEL_NUMBERS + 1;

export type PocketColor = "red" | "black" | "green";

/**
 * Colour of a pocket.
 *
 * Odd red / even black. A real wheel's assignment is deliberately irregular to
 * frustrate pattern-hunting, but that irregularity is invisible at 19 pockets
 * and just reads as a mistake — a rule the player can see is better here.
 */
export function colorOf(n: number): PocketColor {
  if (n === 0) return "green";
  return n % 2 === 1 ? "red" : "black";
}

export type BetKind =
  | { kind: "straight"; n: number }
  | { kind: "color"; color: "red" | "black" }
  | { kind: "parity"; odd: boolean }
  | { kind: "half"; high: boolean }
  | { kind: "third"; index: 0 | 1 | 2 };

export interface BetDef {
  id: string;
  label: string;
  bet: BetKind;
  /** Total return multiplier on a win, stake INCLUDED. */
  pays: number;
}

/** Numbers covered by a third: 1–6, 7–12, 13–18. */
export function thirdRange(index: 0 | 1 | 2): [number, number] {
  const lo = index * 6 + 1;
  return [lo, lo + 5];
}

/** Does `n` win this bet? Zero loses everything except a straight-up on 0. */
export function wins(bet: BetKind, n: number): boolean {
  switch (bet.kind) {
    case "straight":
      return n === bet.n;
    case "color":
      return colorOf(n) === bet.color;
    case "parity":
      // Zero is neither odd nor even for betting purposes — that IS the edge.
      return n !== 0 && (n % 2 === 1) === bet.odd;
    case "half":
      if (n === 0) return false;
      return bet.high ? n > WHEEL_NUMBERS / 2 : n <= WHEEL_NUMBERS / 2;
    case "third": {
      if (n === 0) return false;
      const [lo, hi] = thirdRange(bet.index);
      return n >= lo && n <= hi;
    }
  }
}

/**
 * The bets on offer.
 *
 * `pays` is the TOTAL return including the stake, matching `RoundResult.payout`
 * — so a straight-up is 18×, not "17:1". Keeping one convention end to end is
 * what stops an off-by-one-stake bug hiding in the payout path.
 */
export const BETS: BetDef[] = [
  { id: "red", label: "RED", bet: { kind: "color", color: "red" }, pays: 2 },
  { id: "black", label: "BLACK", bet: { kind: "color", color: "black" }, pays: 2 },
  { id: "odd", label: "ODD", bet: { kind: "parity", odd: true }, pays: 2 },
  { id: "even", label: "EVEN", bet: { kind: "parity", odd: false }, pays: 2 },
  { id: "low", label: "1-9", bet: { kind: "half", high: false }, pays: 2 },
  { id: "high", label: "10-18", bet: { kind: "half", high: true }, pays: 2 },
  { id: "t1", label: "1-6", bet: { kind: "third", index: 0 }, pays: 3 },
  { id: "t2", label: "7-12", bet: { kind: "third", index: 1 }, pays: 3 },
  { id: "t3", label: "13-18", bet: { kind: "third", index: 2 }, pays: 3 },
];

/** A straight-up bet on one number. Built on demand — 19 buttons is a lot. */
export function straightBet(n: number): BetDef {
  return { id: `n${n}`, label: String(n), bet: { kind: "straight", n }, pays: POCKETS - 1 };
}

/** Spin the wheel. */
export function spinWheel(rand: () => number = Math.random): number {
  return Math.floor(rand() * POCKETS);
}

/** Settle a bet against a result. Returns the stake multiplier (0 = lost). */
export function settleBet(bet: BetDef, pocket: number): { multiplier: number; label: string } {
  const won = wins(bet.bet, pocket);
  const col = colorOf(pocket).toUpperCase();
  const where = pocket === 0 ? "ZERO" : `${pocket} ${col}`;
  return won
    ? { multiplier: bet.pays, label: `${where} — ${bet.label} WINS` }
    : { multiplier: 0, label: `${where} — ${bet.label} LOSES` };
}

/**
 * Exact RTP of a bet by enumerating every pocket.
 *
 * Every bet on the table should come out at 18/19 ≈ 0.9474. Any that doesn't is
 * mispriced, which the test asserts across all of them — a single wrong `pays`
 * is otherwise invisible until someone farms it.
 */
export function exactRtp(bet: BetDef): number {
  let total = 0;
  for (let n = 0; n < POCKETS; n++) total += settleBet(bet, n).multiplier;
  return total / POCKETS;
}
