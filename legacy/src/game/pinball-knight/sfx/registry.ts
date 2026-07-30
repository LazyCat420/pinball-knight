/**
 * The name→sting table, and the one type that replaces two anonymous ones.
 *
 * ── WHAT THIS IS *NOT* FOR ───────────────────────────────────────────────────
 * This is NOT a call path. The ~97 call sites keep their named imports and are
 * not migrated to `playSfx("name")`, deliberately:
 *
 *   · named imports are type-safe and rename-refactorable; a string key is
 *     neither, and trades that away for nothing a caller gains
 *   · `sfxCartBell(near)` cannot be typed through `Record<SfxName, () => void>`
 *     without either lying about the signature or inventing a params union
 *   · a HALF migration — some sites by import, some by string — is worse than
 *     either, which is exactly why the registry must not become a call path
 *
 * The ask was "organised", not "string-keyed". Note that
 * `utils/audio-manager.ts` already has a `playSfx(type: string)` switch for the
 * other minigames, and this game has always deliberately not used it.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────
 * 1. **The audition panel.** Audio is the one part of this game that cannot be
 *    verified automatically — `?playtest=1` forces global mute, so every green
 *    playtest run is green about sound by VACUITY. A human with headphones is the
 *    only instrument, and a human needs a way to fire all 28 on demand. That
 *    needs a name→function table.
 * 2. **`SfxTrigger`**, which replaces the two anonymous `() => void` fields in
 *    `entities/marble.ts` and `entities/ricochet-form.ts`. One named type instead
 *    of two unnamed ones — and because it is `() => void`, it correctly EXCLUDES
 *    `sfxCartBell` from those tables at compile time.
 */
import * as combat from "./combat";
import * as weapons from "./weapons";
import * as pinball from "./pinball";
import * as monsters from "./monsters";
import * as world from "./world";
import * as run from "./run";
import type { SfxCategory } from "./bus";

/**
 * A sound a data table can hold a reference to.
 *
 * Zero-arg on purpose: `sfxCartBell(near)` is not assignable, so the compiler
 * stops anyone parking the merchant bell in a table that will call it with no
 * proximity and get a silent 0.03-gain chime.
 */
export type SfxTrigger = () => void;

/**
 * Every sting, keyed by short name. Derived from the category modules by
 * spreading them, so a new sting joins the table by existing — there is no second
 * hand-maintained list to fall out of date.
 */
export const SFX = {
  // combat
  swing: combat.sfxSwing,
  heavy: combat.sfxHeavy,
  hit: combat.sfxHit,
  hurt: combat.sfxHurt,
  break: combat.sfxBreak,
  // weapons
  gun: weapons.sfxGun,
  bow: weapons.sfxBow,
  flame: weapons.sfxFlame,
  freeze: weapons.sfxFreeze,
  // pinball
  bumper: pinball.sfxBumper,
  spring: pinball.sfxSpring,
  spin: pinball.sfxSpin,
  target: pinball.sfxTarget,
  roll: pinball.sfxRoll,
  // monsters
  groan: monsters.sfxGroan,
  zombieDie: monsters.sfxZombieDie,
  goblin: monsters.sfxGoblin,
  cackle: monsters.sfxCackle,
  ribbit: monsters.sfxRibbit,
  /**
   * Widened HERE and only here. `sfxCartBell` genuinely requires its proximity
   * argument, and that is load-bearing: it is what makes `SfxTrigger` reject it
   * at compile time, so nobody can park the merchant bell in one of the
   * function-reference tables that would call it with no argument and get a
   * silent 0.03-gain chime. The audition panel is the one caller allowed to
   * supply a default, so the cast lives at that boundary rather than in the
   * sting's own signature.
   */
  cartBell: monsters.sfxCartBell as (near?: number) => void,
  // world
  pickup: world.sfxPickup,
  trapdoor: world.sfxTrapdoor,
  coin: world.sfxCoin,
  // run
  levelStart: run.sfxLevelStart,
  modifier: run.sfxModifier,
  bossReveal: run.sfxBossReveal,
  stairs: run.sfxStairs,
  gameOver: run.sfxGameOver,
} satisfies Record<string, (near?: number) => void>;

export type SfxName = keyof typeof SFX;

/** Which bus each name plays on — for the audition panel's grouping. */
export const SFX_CATEGORY: Record<SfxName, SfxCategory> = {
  swing: "combat",
  heavy: "combat",
  hit: "combat",
  hurt: "combat",
  break: "combat",
  gun: "weapons",
  bow: "weapons",
  flame: "weapons",
  freeze: "weapons",
  bumper: "pinball",
  spring: "pinball",
  spin: "pinball",
  target: "pinball",
  roll: "pinball",
  groan: "monsters",
  zombieDie: "monsters",
  goblin: "monsters",
  cackle: "monsters",
  ribbit: "monsters",
  cartBell: "monsters",
  pickup: "world",
  trapdoor: "world",
  coin: "world",
  levelStart: "run",
  modifier: "run",
  bossReveal: "run",
  stairs: "run",
  gameOver: "run",
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];

/**
 * Fire a sting by name. For the DEBUG AUDITION PANEL and the console — not for
 * gameplay. See the header for why gameplay keeps its named imports.
 */
export function playSfx(name: SfxName, arg = 0.8): void {
  (SFX[name] as (n?: number) => void)(arg);
}
