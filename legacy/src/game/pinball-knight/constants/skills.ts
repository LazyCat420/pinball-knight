/**
 * Cards, abilities, mana, rampage and their presentation timings.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
import { PLAYER_SPEED } from "./player";

// ── Combat juice (hitstop + shake) ──────────────────────────────
/**
 * Hit-freeze — the single biggest "game feel" trick. On a landed hit the whole
 * fixed-step simulation pauses for a few frames (VFX and rendering keep going),
 * so the impact reads as a crunch instead of a soft overlap. Kills freeze a
 * touch longer for weight.
 */
export const HITSTOP_HIT = 0.05;
export const HITSTOP_KILL = 0.09;
/** Screen-shake timer set when the player LANDS a hit (taking a hit is separate). */
export const SHAKE_ON_HIT = 0.1;
export const SHAKE_ON_KILL = 0.2;

// ── Cards (cards.ts) — on-hit status tuning + the pinball-synergy speed gate ──
export const CARD_PINBALL_SPEED = 8; // momSpeed above which pinball-synergy cards fire

/**
 * THE MOMENTUM RAMP (`momentumT`, entities/combo-curve.ts) — the one curve that
 * turns "are you fast?" from a yes/no into a dial.
 *
 * Every momentum-scaling system in the game used to read the same binary gate,
 * `momSpeed > CARD_PINBALL_SPEED`: nothing at 7.9 u/s, everything at 8.1, and
 * not one point more at terminal speed. Eight out of a 22 ceiling is 36% — so
 * a "momentum build" was fully switched on at barely a third of top speed and
 * had no reason to ever go faster. That single constant was the flattest number
 * in the codebase.
 *
 * The ramp replaces the cliff: 0 at a walk, climbing CONCAVELY (most of the
 * gain is bought early, the way every other curve in combo-curve.ts works) and
 * reaching exactly 1 at PINBALL_MAX_SPEED. Hyperbolic, so it is structurally
 * incapable of running away no matter what multiplies it — the same reason the
 * booster corner-jam fix had to live at the aggregate rather than in a guard.
 *
 * This deliberately REDISTRIBUTES rather than adds: below the old gate you now
 * get something where you got nothing, and at the old gate you get ~61% where
 * you got 100%. Full value is earned at full speed. That is the point.
 */
export const MOMENTUM_T_FLOOR = PLAYER_SPEED; // at or below a walk the ramp reads 0
export const MOMENTUM_T_K = 0.22; // curvature; smaller = more front-loaded
export const CARD_CHILL_TIME = 2.5; // seconds an enemy stays chilled
export const CARD_CHILL_SLOW = 0.5; // movement multiplier while chilled
export const CARD_BURN_TIME = 3.0; // seconds an enemy burns
export const CARD_BURN_TICK = 0.5; // seconds between burn ticks
export const CARD_BURN_DMG = 1; // damage per burn tick
// ── Thunderbolt on-hit (storm cards) — a line-AoE that arcs out along the strike ──
export const CARD_BOLT_LENGTH = 5; // blocks the bolt travels in front of the struck foe
export const CARD_BOLT_HALF_WIDTH = 0.9; // blocks either side of the bolt line that gets hit
export const CARD_BOLT_DAMAGE = 4; // damage dealt to every foe caught in the line
export const CARD_BOLT_COOLDOWN = 0.6; // seconds between bolts (throttles rapid swings)

export const PARTS_BASE = 6; // parts on level 1
export const PARTS_PER_LEVEL = 2; // extra parts per depth…
export const PARTS_MAX = 26; // …capped

// ── RAMPAGE (the FPS ultimate) ──────────────────────────────────
/**
 * The maze is REAL 3D, so the ultimate just swaps the ortho iso camera for a
 * first-person perspective one at eye height and lets you blast down the
 * corridors Doom-style. The pixel/quantize pass stays on, so it reads as a
 * chunky DOS-era FPS. Charges from kills; ends on a timer.
 */
export const ULT_CHARGE_PER_KILL = 0.09; // ~11–12 kills to fill the meter
export const ULT_DURATION = 12; // seconds of rampage per activation

// ── MANA & ABILITIES (Diablo-HUD skill economy) ──────────────────
// A SEPARATE resource from the rampage ult meter (deliberately un-aliased): the
// ult is a kill-charged god-mode; mana is a steady spendable pool for the two
// Q/E active skills. Regenerates over time and tops up a little per kill so the
// skills stay in rotation without ever refuelling a rampage.
export const MANA_MAX = 100;
export const MANA_REGEN = 7; // per second, passive
export const MANA_PER_KILL = 6; // small top-up on an ordinary kill
export const ARCANE_PULSE_RADIUS = 3.4; // tiles — Arcane Pulse AoE reach
export const ARCANE_PULSE_DAMAGE = 5;
export const FLIPPER_LAUNCH_SPEED = 19; // momentum burst Flipper Charge injects
export const MAGNET_AURA_PULL = 8; // tiles/sec ground items drift to you
export const TIMECRAWL_FACTOR = 0.3; // enemy dt scale while Time Crawl runs
export const BLADESTORM_RADIUS = 1.6; // tiles the orbiting blades reach
export const BLADESTORM_DAMAGE = 2; // per tick
export const BLADESTORM_TICK = 0.35; // seconds between blade hits

// ── Arcane Pulse shockwave ── damage rides the expanding ring, not an instant
// AoE: each foe is hit the frame the wave front crosses it (sonar-ping read).
export const PULSE_WAVE_DUR = 0.55; // seconds the ring takes to reach full radius
export const PULSE_RING_LAG = 0.07; // the purple chaser ring starts this far behind
export const PULSE_RIM_BURSTS = 8; // impact pops around the rim at max radius
/** Ground bolts forked at the cast, and again mid-flight — the "lightning
 *  crown" that makes the pulse read as an arcane DISCHARGE instead of a hoop. */
export const PULSE_CAST_FORKS = 8;
export const PULSE_MID_FORKS = 6;
/** Short arcs snapping off the LIVE wave front, and how often. Keeps the front
 *  reading as travelling energy instead of a hoop being scaled up. */
export const PULSE_CRACKLE_ARCS = 2;
export const PULSE_CRACKLE_EVERY = 0.07;
/** The summoning glyph struck under the caster: how long it burns and how fast
 *  it turns (rad/s — the inner wheel counter-rotates faster). */
export const PULSE_SIGIL_LIFE = 0.85;
export const PULSE_SIGIL_SPIN = 1.4;
/** Arcane motes thrown UP the cast point, so the spell has a vertical too. */
export const PULSE_COLUMN_MOTES = 14;
/** The pulse's palette. Arcane light/mid (31/30) — NOTHING in this spell is
 *  allowed to be red, which is what the original off-palette purple quantized
 *  to. Near-white cores come from the particle pools themselves. */
export const PULSE_C_LIGHT = 0x6fd0e8;
export const PULSE_C_MID = 0x2e6d8f;

// ── Sustained-buff LOOKS ── Blade Storm, Magnet Aura and Time Crawl are states,
// not events, so each one draws on a beat for as long as it is up. Cadences are
// deliberately coarse (a few per second): the ring/ghost pools are small, and a
// per-frame spawn would chew through them and thin every other effect on screen.
/** Blade Storm: crescents in the visible ring, and its orbit speed (rad/s). */
export const BLADESTORM_BLADES = 3;
export const BLADESTORM_SPIN = 7.5;
/** Magnet Aura: the field's drawn reach, its collapse-ring beat, and how many
 *  items get an arc snapped onto them per beat. */
export const MAGNET_FIELD_R = 3.2;
export const MAGNET_PULSE_EVERY = 0.42;
export const MAGNET_LEASH_MAX = 3;
/** Time Crawl: the field's drawn reach and the beat its enemy-smear ghosts run
 *  at (the ghosts are the effect — the horde visibly dragging). */
export const TIMECRAWL_FIELD_R = 4.2;
export const TIMECRAWL_SMEAR = 0.22;

// ── Flipper Charge fire trail ── the launch ignites the knight: flame ghosts +
// embers while riding, and a burning floor scar per NEW tile crossed. Uses the
// existing fire floorFx, so the horde burns on it and the player doesn't (unless
// the self-harm debug toggle is on).
export const FLIPPER_TRAIL_T = 0.9; // matches the launch's turbo ride-out
export const FLIPPER_TRAIL_MIN_SPEED = 6; // u/s — below this the fire gutters out
export const FLIPPER_TRAIL_RADIUS = 0.55; // per-tile burn disc
export const FLIPPER_TRAIL_LIFE = 3.5; // seconds each trail tile keeps burning
export const FLIPPER_TRAIL_GHOST_T = 0.05; // seconds between flame afterimages

// ── Slick Field (oil) ── a spilled oil pool: foes lose steering on it, the
// rolling ball picks up the existing p.oilT glide, and any overlapping FIRE
// floorFx ignites the whole pool.
export const OIL_SLICK_RADIUS = 1.6; // the spill (≈3×3 tiles)
export const OIL_SLICK_LIFE = 12; // seconds the pool lingers
export const OIL_ZOMBIE_T = 2.5; // greased-steering seconds, refreshed while inside
export const OIL_STEER_BLEND = 1.1; // per-second heading blend while oiled (low = skid)
export const OIL_MARBLE_T = 0.35; // p.oilT topped to this while the ball crosses oil
export const OIL_IGNITE_LIFE = 8; // seconds an ignited pool burns

// ── Katana finisher presentation ──
export const FINISHER_FLASH_T = 0.14; // seconds of full-screen white flash on connect
export const FINISHER_FLASH_MAX = 0.75; // peak flash intensity fed to the pixel pass
export const FPS_EYE_HEIGHT = 0.62; // camera height above the floor, world units
export const FPS_FOV = 75; // degrees — wide, Wolfenstein-ish
export const FPS_MOVE_SPEED = 5.6; // faster than the iso walk — you're a wrecking ball
export const FPS_TURN_SPEED = 2.6; // radians/sec for keyboard turn (Q/E, arrows)
export const FPS_MOUSE_SENS = 0.0026; // radians per pixel of mouse movement
export const FPS_PITCH_LIMIT = 0.5; // radians up/down clamp
export const FPS_SHOT_COOLDOWN = 0.14; // rapid-fire hitscan
export const FPS_SHOT_DAMAGE = 3; // hitscan damage per shot
export const FPS_SHOT_RANGE = 14; // tiles a hitscan shot reaches
