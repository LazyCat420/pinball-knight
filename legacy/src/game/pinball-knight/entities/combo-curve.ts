/**
 * PROGRESSIVE COMBO RAMP — the pure math of the pinball combo curve.
 *
 * The old chain was linear: every bounce +1 combo, +1 gold, and speed climbed
 * multiplicatively straight into the PINBALL_MAX_SPEED wall. This module makes
 * the whole ramp CONCAVE — early combos pay off urgently, then flatten — across
 * six levers (speed ceiling, restitution taper, combo window, friction, gold,
 * tempo zones). Every function here is pure and unit-tested; the callers in
 * player.ts / combat.ts / core.ts read them per bounce.
 *
 * DELIBERATELY three- and state-free (same contract as maze/generator.ts): the
 * curve is testable in isolation, which is the only way to keep a feel change
 * honest without a live playtest.
 */
import {
  PINBALL_MAX_SPEED,
  PINBALL_CORNER_RESTITUTION,
  PINBALL_CORNER_ADD,
  STYLE_KILL_BASE_GOLD,
  COMBO_CEIL_BASE,
  COMBO_CEIL_K,
  COMBO_CEIL_NSAT,
  COMBO_REST_LAMBDA,
  COMBO_ADD_MU,
  COMBO_WINDOW_MAX,
  COMBO_WINDOW_MIN,
  COMBO_WINDOW_ALPHA,
  COMBO_DMG_MAX,
  COMBO_DMG_K,
  COMBO_DMG_NSAT,
  COMBO_FRICTION_K,
  COMBO_GOLD_TIER,
  COMBO_ZONE_CRUISE,
  COMBO_ZONE_FRENZY,
} from "../constants";

export type ComboZone = "launch" | "cruise" | "frenzy";

/**
 * Part 1 — logarithmic ceiling on the speed a WALL/CORNER bounce can EARN:
 *   Vmax(n) = Vbase + (Vcap − Vbase) · ln(1+k·n) / ln(1+k·Nsat)
 * By ~8 bounces you're ~60% of the way from base to cap, ~95% by Nsat, and the
 * last sliver takes many more — you never feel the wall. This caps GAINS only;
 * parts (plunger/spring/ramp) launch to their own speeds at combo 0 and the
 * caller never lets a bounce drag you below the speed you already carry.
 */
export function comboSpeedCeil(n: number): number {
  const nn = Math.max(0, n);
  const num = Math.log(1 + COMBO_CEIL_K * nn);
  const den = Math.log(1 + COMBO_CEIL_K * COMBO_CEIL_NSAT);
  return COMBO_CEIL_BASE + (PINBALL_MAX_SPEED - COMBO_CEIL_BASE) * Math.min(1, num / den);
}

/**
 * Part 3 — corner restitution tapers from its peak (combo 0, the most exciting
 * corner) toward 1.0 (speed-neutral) as the chain deepens:
 *   R(n) = 1 + (Rpeak − 1)·e^(−λn)
 */
export function comboCornerRestitution(n: number): number {
  return 1 + (PINBALL_CORNER_RESTITUTION - 1) * Math.exp(-COMBO_REST_LAMBDA * Math.max(0, n));
}

/** Part 3 — the flat per-corner kick decays toward nothing: A(n) = Amax·e^(−μn). */
export function comboCornerAdd(n: number): number {
  return PINBALL_CORNER_ADD * Math.exp(-COMBO_ADD_MU * Math.max(0, n));
}

/**
 * Part 4 — the combo window shrinks with depth then stabilises:
 *   W(n) = Wmin + (Wmax − Wmin)·e^(−αn)
 * Generous while you learn the line, tight once you're deep — a second of open
 * floor drops a high chain, which is what kills the ping-pong ceiling.
 */
export function comboWindow(n: number): number {
  return COMBO_WINDOW_MIN + (COMBO_WINDOW_MAX - COMBO_WINDOW_MIN) * Math.exp(-COMBO_WINDOW_ALPHA * Math.max(0, n));
}

/**
 * Part 5 — global friction multiplier rising with combo: F(n) = 1 + k·√n.
 * At high combo open floor grips a touch more, biasing toward tight machine
 * routes. Gentle by design (+15% at 100×) so it never fights the open-floor
 * highway outright, just nudges the deep chain back onto the track.
 */
export function comboFrictionMul(n: number): number {
  return 1 + COMBO_FRICTION_K * Math.sqrt(Math.max(0, n));
}

/**
 * Part 6 — tiered jackpot gold, +COMBO_GOLD_TIER per DOUBLING of the combo:
 *   gold(n) = Gbase + Gtier·⌊log2(max(n,1))⌋
 * 1→2g, 2-3→5g, 4-7→8g, 8-15→11g, 16-31→14g, 32-63→17g, 64+→20g. Logarithmic,
 * so mastery always reads as progress and the economy never breaks.
 */
export function comboKillGold(n: number): number {
  return STYLE_KILL_BASE_GOLD + COMBO_GOLD_TIER * Math.floor(Math.log2(Math.max(1, n)));
}

/**
 * Part 7 — the chain's DAMAGE multiplier, the only lever here that reaches
 * combat:
 *   D(n) = 1                                            for n < Ncruise
 *   D(n) = 1 + (Dmax − 1)·log(1 + k·(n − Ncruise)) / log(1 + k·Nsat)
 *
 * Nothing below the Cruise gate — combo 8 is already where the game flips into
 * its flow state (comboZone arms ball form there), so the ramp starts on a
 * threshold the player can already feel rather than inventing a new one.
 *
 * Same log-saturating shape as `comboSpeedCeil` so speed and lethality read as
 * one system, and capped at COMBO_DMG_MAX (1.35×) — well under the invested
 * `pinballMult` cards, which this multiplies with rather than replaces.
 *
 * 8→1.00, 16→1.12, 30→1.22, 60→1.33, 100→1.35 (saturating).
 */
export function comboDamageMult(n: number): number {
  const over = Math.max(0, n - COMBO_ZONE_CRUISE);
  if (over <= 0) return 1;
  const num = Math.log(1 + COMBO_DMG_K * over);
  const den = Math.log(1 + COMBO_DMG_K * COMBO_DMG_NSAT);
  return 1 + (COMBO_DMG_MAX - 1) * Math.min(1, num / den);
}

/** Part 2 — which tempo act the current combo count sits in. */
export function comboZone(n: number): ComboZone {
  if (n >= COMBO_ZONE_FRENZY) return "frenzy";
  if (n >= COMBO_ZONE_CRUISE) return "cruise";
  return "launch";
}

/**
 * Frenzy intensity in [0,1] for the presentation FX (vignette pull + chromatic
 * aberration): 0 below the frenzy threshold, ramping to 1 over the next
 * threshold's worth of combo so the edge-of-control look eases in rather than
 * snapping on.
 */
export function frenzyIntensity(n: number): number {
  if (n < COMBO_ZONE_FRENZY) return 0;
  return Math.min(1, (n - COMBO_ZONE_FRENZY) / COMBO_ZONE_FRENZY);
}
