/**
 * SFX — every sound in the dungeon, in one folder.
 *
 * ── EVERYTHING HERE IS SYNTHESIZED ───────────────────────────────────────────
 * There are ZERO audio files in this repo, and that is the house rule rather than
 * a shortcut. Square waves, fast envelopes and filtered noise bursts are exactly
 * what an NES sounded like, so the constraint and the art direction agree. If you
 * are looking for a `.wav` to replace, there isn't one — edit the synthesis.
 *
 * ── LAYOUT ───────────────────────────────────────────────────────────────────
 *   bus.ts        the mixer: mute gates, volume, per-category gain, fail-silent
 *   synth.ts      beep() and burst() — the only two primitives
 *   gate.ts       gate() and voice() — rate limiting, keyed on the AUDIO clock
 *   registry.ts   name → sting, for the debug audition panel. NOT a call path.
 *
 *   combat.ts     swing heavy hit hurt break
 *   weapons.ts    gun bow flame freeze
 *   pinball.ts    bumper spring spin target roll
 *   monsters.ts   groan zombieDie goblin cackle ribbit cartBell
 *   world.ts      pickup trapdoor coin
 *   run.ts        levelStart modifier bossReveal stairs gameOver
 *
 * The split names where a sound comes from in the GAME, not what it sounds like,
 * so a dev editing `entities/combat.ts` looks in `sfx/combat.ts`. `sfxRoll` sits
 * in `pinball` despite being a body whoosh because six of its ten call sites are
 * momentum; `sfxHeavy` stays in `combat` even though it doubles as a cracking
 * gravestone.
 *
 * ── HOW GAMEPLAY CALLS THESE ─────────────────────────────────────────────────
 * By NAMED IMPORT, always: `import { sfxBumper } from "../sfx"`. There is a
 * name→function registry but it is for the audition panel, not for gameplay — see
 * `registry.ts` for why a string API would be a downgrade here.
 *
 * ── TWO RULES WORTH KNOWING BEFORE YOU EDIT ──────────────────────────────────
 * 1. **Fail-silent is a contract, not a nicety.** Audio must never be able to
 *    break the game, so every sting no-ops on a null context and every node
 *    creation is wrapped. A sound that throws into the game loop from whatever was
 *    mid-swing is a far worse bug than a sound that does not play.
 * 2. **Throttle at the CALL SITE, never inside a sting.** `sfxFlame` is the
 *    flamethrower, the fire vent and the lava marble; gating it centrally to calm
 *    one of those silences the others.
 *
 * ── AND ONE ABOUT VERIFYING IT ───────────────────────────────────────────────
 * `?playtest=1` and `?mute=1` force global mute at module load, so `getAudioCtx()`
 * returns null for the whole run and all 28 stings no-op. **Every green playtest
 * run is green about audio by vacuity.** Never cite one as evidence a sound works.
 * What IS automated: `sfx-snapshot.test.ts` pins every pitch and gain, and
 * `sfx/bus.test.ts` proves nothing bypasses the mixer. The rest is headphones.
 */
export { setSfxMuted, isSfxMuted, setSfxVolume, getSfxVolume, resetBus } from "./bus";
export type { SfxCategory, Bus } from "./bus";
export { gate, voice, resetGates } from "./gate";
export { SFX, SFX_CATEGORY, SFX_NAMES, playSfx } from "./registry";
export type { SfxName, SfxTrigger } from "./registry";

export { sfxSwing, sfxHeavy, sfxHit, sfxHurt, sfxBreak } from "./combat";
export { sfxGun, sfxBow, sfxFlame, sfxFreeze } from "./weapons";
export { sfxBumper, sfxSpring, sfxSpin, sfxTarget, sfxRoll } from "./pinball";
export { sfxGroan, sfxZombieDie, sfxGoblin, sfxCackle, sfxRibbit, sfxCartBell } from "./monsters";
export { sfxPickup, sfxTrapdoor, sfxCoin } from "./world";
export { sfxLevelStart, sfxModifier, sfxBossReveal, sfxStairs, sfxGameOver } from "./run";
