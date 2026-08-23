/**
 * STAGGER — Doom's pain chance, priced in momentum and paid without dice.
 *
 * ## What this is for
 *
 * Doom's monster table has three independent dials, and the one that decides
 * how a fight FEELS is not HP or damage — it is pain chance. Every damage event
 * rolls against it; success interrupts the monster. High-pain monsters (imp,
 * zombieman, ~78%) can be stunlocked by rapid weak hits; a baron (17%) barely
 * flinches and an arch-vile (3%) never stops. That single stat is what converts
 * DPS into crowd control, and it is why the chaingun "suppresses" a cacodemon
 * and merely annoys a baron.
 *
 * Pinball Knight has the DPS half and none of the control half: until now every
 * hit did damage and nothing else, so a horde could only ever be deleted, never
 * held off. Worse, the game's signature verb — arriving at speed — bought
 * exactly nothing but a damage multiplier.
 *
 * So pain chance here is SCALED BY MOMENTUM (`momentumT`, the shared Wave-1
 * ramp). A poke at walking pace almost never staggers; a ricochet at terminal
 * speed staggers fodder nearly every time, which is what makes a bounce chain
 * through a pack read as a chain rather than as several separate hits. It is
 * one more thing the momentum system decides, per DECLONE §1's spine.
 *
 * ## Why an accumulator and not a roll
 *
 * `Math.random()` on a horde path is forbidden here: co-op peers simulate the
 * same floor locally and a divergent roll desyncs who is staggered on whose
 * screen (`coop-determinism.test.ts` is the standing gate). But "just seed an
 * RNG" would still be the wrong shape — at a fixed 60 Hz with contact events
 * arriving in bursts, i.i.d. rolls produce visible streaks, and a streak of
 * five unstaggered hits during a bounce chain reads as the mechanic being
 * broken.
 *
 * PoE solved exactly this for evasion and the fix transfers unchanged: an
 * ENTROPY ACCUMULATOR. Add the chance to a per-actor counter on every event;
 * when it crosses 100, the event fires and 100 comes off. With a 40% chance you
 * are staggered almost exactly 2 hits in 5 — the mean is identical to dice, the
 * variance is bounded, and the whole thing is arithmetic on one number, so a
 * replay and a co-op peer agree by construction rather than by luck.
 *
 * Pure and dependency-light on purpose: `stagger.test.ts` measures the
 * distribution rather than trusting the description.
 */
import { momentumT } from "./combo-curve";
import { STAGGER_SPEED_FLOOR, STAGGER_TIME_MIN, STAGGER_TIME_MAX, ENTROPY_FULL } from "../constants";
import { ZOMBIE_TYPES } from "../zombie-types";
import type { EnemyKind, Zombie } from "../state";

/**
 * Base pain chance per family, at TERMINAL speed. Exhaustive by `EnemyKind` on
 * purpose — the same discipline `ENEMY_DROPS` and `KIND_INFO` keep, so adding a
 * monster is a compile error here rather than a monster nobody can stagger.
 *
 * It lives in this module rather than in zombie.ts's `STATS` for one boring
 * reason: `combat.ts` is where a hit resolves, and `zombie.ts` already imports
 * `combat.ts`. Putting the table where the mechanic is keeps the dependency a
 * line instead of a loop.
 *
 * Calibrated off Doom's own table (pain chance /255): zombieman/imp 78%, pinky
 * 70%, cacodemon 50%, revenant 39%, hell knight 17%, arch-vile 3%. The reading
 * that matters is the RANKING, not the numbers — fodder is
 * ricochet-stunlockable and elites are not, which is how Doom makes a baron
 * feel relentless without touching its damage.
 *
 * 0 = unstaggerable. The pin's stagger IS its slide, the reaper cannot be
 * damaged at all, and the golem is masonry.
 */
export const PAIN_BY_KIND: Record<EnemyKind, number> = {
  zombie: 0.78,
  spider: 0.7,
  brute: 0.2,
  spitter: 0.65,
  ghost: 0.3,
  bat: 0.85,
  slime: 0.55,
  reaper: 0,
  goblin: 0.6,
  sporeling: 0.5,
  jester: 0.7,
  croaker: 0.75,
  // Second only to the bat. A hit does not just hurt it, it stalls the rotor —
  // and the sag that follows is the reward for reaching something that shoots
  // from out of reach. See render/monsters/rotortail.ts's `stumble` clip.
  rotortail: 0.8,
  // THE HIGHEST IN THE ROSTER, past the bat. It is a heavy body balanced on four
  // lashed poles, and pain chance is momentum-scaled — so "arrive fast and it
  // goes over" needs no new mechanic, only this number and a `stumble` clip that
  // shows the poles splaying (render/monsters/stiltneck.ts).
  stiltneck: 0.9,
  fish_feet: 0.65,
  pin: 0,
  golem: 0.05,
  chomper: 0.15,
  magnet: 0.55,
  webspinner: 0.65,
  hound: 0.45,
  bloater: 0.4,
  necromancer: 0.35,
  warden: 0.25,
  wisp: 0.7,
  sapper: 0.6,
  crystalback: 0.1,
  mimic: 0.35,
};

/**
 * This actor's base pain chance: its family's, times its zombie sub-type's
 * modifier, and ZERO for a boss.
 *
 * The Reaper King being unstaggerable is not an oversight — it is Doom's
 * arch-vile rule taken to its limit. A boss you can hold in place with a
 * ricochet chain is a boss with no fight in it, and DECLONE §6.3 (making his
 * attacks battable) is the deliberate, separate way he becomes momentum-legible.
 */
export function painBase(z: Zombie): number {
  if (z.boss) return 0;
  const fam = PAIN_BY_KIND[z.kind];
  return fam * (z.ztype ? ZOMBIE_TYPES[z.ztype].painMult ?? 1 : 1);
}

/** The per-actor slice an accumulator owns. Structurally satisfied by `Zombie`. */
export interface EntropyHolder {
  painEntropy?: number;
  dodgeEntropy?: number;
}

/**
 * How likely this hit is to interrupt, given the family's base pain chance and
 * the speed the blow arrived at.
 *
 * `STAGGER_SPEED_FLOOR` is what a standing hit is worth — small but not zero,
 * so a heavy weapon still occasionally rocks something. Everything above that
 * is bought with speed, on the same concave ramp cards and weapons read.
 */
export function painChance(base: number, impactSpeed: number): number {
  if (base <= 0) return 0;
  const t = momentumT(impactSpeed);
  return Math.max(0, Math.min(1, base * (STAGGER_SPEED_FLOOR + (1 - STAGGER_SPEED_FLOOR) * t)));
}

/** How long a stagger lasts — a fast hit doesn't just land more often, it holds longer. */
export function staggerTime(impactSpeed: number): number {
  return STAGGER_TIME_MIN + (STAGGER_TIME_MAX - STAGGER_TIME_MIN) * momentumT(impactSpeed);
}

/**
 * Accrue `chance` (0..1) into `field` and report whether it fired.
 *
 * The counter is deliberately NOT reset to zero on a trigger — 100 is
 * SUBTRACTED, so leftover entropy carries into the next event and a long run of
 * events converges on the exact mean. Zeroing it would quietly lower the real
 * rate below the printed one, which is the classic version of this bug.
 *
 * A chance of ≥1 fires every time and cannot bank more than one trigger's worth,
 * so no amount of overkill buys a stagger the actor has not been hit for.
 */
export function accrue(holder: EntropyHolder, field: "painEntropy" | "dodgeEntropy", chance: number): boolean {
  if (chance <= 0) return false;
  const e = (holder[field] ?? 0) + chance * ENTROPY_FULL;
  if (e >= ENTROPY_FULL) {
    holder[field] = Math.min(e - ENTROPY_FULL, ENTROPY_FULL - 1e-9);
    return true;
  }
  holder[field] = e;
  return false;
}
