/**
 * Coins, gold, shop, NPCs and pickup power-ups.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
// ── Wave-J shop (Rolling Cart Merchant) ─────────────────────────
/**
 * The merchant is a CART that slides around the floor and SPEEDS UP as you
 * close on it (you have to corner it). Catch it → a shop overlay opens; spend
 * banked gold on the pinball kit. One cart per floor from MERCHANT_FROM_LEVEL.
 */
export const MERCHANT_FROM_LEVEL = 2;
export const MERCHANT_SPEED = 2.2; // base drift
export const MERCHANT_FLEE_SPEED = 4.6; // when you're within FLEE_RANGE
export const MERCHANT_FLEE_RANGE = 4.0;
export const MERCHANT_CATCH_RANGE = 0.7;
/**
 * Seconds the cart commits to a heading after bouncing off a wall. Without a
 * commitment window the flee steering recomputes every tick and overwrites the
 * bounce, so the cart grinds along the wall it hit — the old edge-riding bug.
 */
export const MERCHANT_BOUNCE_DWELL = 0.45;
/** Cart-bell cadence + audible radius, so the merchant is huntable not lucky. */
export const MERCHANT_BELL_PERIOD = 3.5;
export const MERCHANT_BELL_RANGE = 26;
/** Rings out from the floor start, so you have to go LOOKING for the cart. */
export const MERCHANT_SPAWN_MIN_RING = 5;

// ── Coin drops — the kill payout ────────────────────────────────
/**
 * A dropped coin lives THREE phases: BURST (pops up and out of the corpse under
 * gravity, lands, bounces), REST (bobs on the floor with the rest of the loot),
 * MAGNET (arcs up into the knight's chest and is absorbed).
 *
 * It used to be one phase: a per-frame `x += (px - x) * 0.22` easing, which ran
 * spawn-to-collected in ~7 frames (118ms). The coin was genuinely on screen and
 * genuinely invisible — the player only ever saw the number go up. Every
 * constant below exists to give the payout enough time on screen to READ as a
 * physical object coming out of a corpse and into the knight.
 */
/** Coins are magnetic — inside this range a resting coin commits to the flight. */
export const COIN_MAGNET_RANGE = 2.6;
/** Magnet Aura widens the coin's own capture range rather than dragging coins. */
export const COIN_AURA_RANGE_MULT = 3;
/** Seconds the magnet flight takes, capture to absorb. Wall-clock, not frames. */
export const COIN_MAGNET_TIME = 0.42;
/** World Y the coin homes on: the knight's CHEST, not the floor it started on. */
export const COIN_CHEST_Y = 0.62;
/** Extra lift at the midpoint of the magnet arc, so it floats in, not slides. */
export const COIN_MAGNET_ARC = 0.34;
/** Burst launch: up-speed, gravity, restitution, outward scatter speed, drag. */
export const COIN_BURST_VY = 2.4;
export const COIN_GRAVITY = 13;
export const COIN_BOUNCE = 0.42;
export const COIN_BURST_SPREAD = 1.25;
export const COIN_BURST_DRAG = 3.2;
/** Below this landing speed the coin stops bouncing and settles into REST. */
export const COIN_SETTLE_VY = 0.5;
/** A coin can't be magnet-captured for this long — the burst must be SEEN. */
export const COIN_ARM_TIME = 0.3;
/** Resting height above the floor (matches the other ground items' bob centre). */
export const COIN_REST_Y = 0.06;
/** Height a coin is born at, just above the corpse. */
export const COIN_SPAWN_Y = 0.35;
/** Coins minted per drop (a drop is split across these), and the live-floor cap. */
export const COIN_MAX_PER_DROP = 6;
export const COIN_LIVE_CAP = 28;
/** A coin worth at least this much paints as a STACK rather than a single token. */
export const COIN_STACK_VALUE = 5;
/**
 * Dropped coins render at a fraction of the full sprite footprint so a burst
 * reads as a Diablo-style PILE of tiny tokens on the floor, not a scatter of
 * dinner-plate discs. Applied to the mesh scale at spawn — the shared sprite
 * quad and every other item stay full size. Stacks get a hair more presence
 * than singles so the high-value drop still stands out.
 */
export const COIN_DROP_SCALE = 0.34;
export const COIN_STACK_DROP_SCALE = 0.44;
/**
 * A weapon dropped in an exchange can't be re-grabbed until you've stepped
 * this far away from it — otherwise the drop and the pickup ping-pong while
 * you stand on the spot.
 */
export const DROP_CLEAR_RANGE = 0.9;

// ── Gold ────────────────────────────────────────────────────────
export const GOLD_PER_KILL = 2;
export const GOLD_PER_DESCENT = 10;

// ── NPCs (Wave E — PINBALL_ROADMAP.md) ──────────────────────────
/**
 * THE MAGICIAN 🎩 — appears on his own clock, bows, and SHUFFLES THE ROOM:
 * loot swaps places with loot and the pinball furniture swaps places with
 * itself, so the lane you'd memorised isn't the lane you're standing in. He
 * does NOT move the knight — the trapdoor is the floor's only teleport, and
 * two systems yanking you around at once is disorienting rather than fun.
 * Can't be killed, can't be stopped; he laughs every time. Suppressed while
 * the Death Dealer is out — two uncontrollable actors at once reads as
 * unfair, not chaotic.
 */
export const MAGICIAN_PERIOD = 45; // base seconds between visits
export const MAGICIAN_JITTER = 12; // ± spread on the period
export const MAGICIAN_FROM_LEVEL = 2;
export const MAGICIAN_BOW = 1.2; // seconds between the entrance and the trick
export const MAGICIAN_LINGER = 2.0; // seconds he savours the laugh before vanishing
export const TRICK_RADIUS = 16; // how far his sleight of hand reaches, world units
export const TRICK_SAFE_RADIUS = 2.5; // furniture this close to the knight is left alone
export const TRICK_PART_SWAPS = 4; // at most this many part PAIRS trade places
/** Furniture the shuffle never touches: hazards, and the hatch the ride needs. */
export const TRICK_FIXED_KINDS = ["pit", "electric", "firevent", "magstrip", "trapdoor"] as const;
/**
 * THE SPEED WITCH 🧙 — hides behind cracked walls (finally a reason to hunt
 * them). One trade per floor: HALF your current hearts for a long
 * turbo+spring-legs power window.
 */
export const WITCH_BUFF_TIME = 30;
export const WITCH_CHANCE = 0.5; // chance a smashed secret reveals her (once per floor)
/**
 * THE ORACLE FROG 🐸 — sits in a dead end; touch it and it croaks out a
 * trail of gold motes tracing the route to the stairs.
 */
export const FROG_COOLDOWN = 20; // seconds between consultations
export const FROG_TRAIL_TILES = 50; // how far the mote trail traces (scaled with 4× floors)
export const FROG_TRAIL_STAGGER = 0.045; // seconds between trail motes

// ── Wave-F power-ups + score glue ───────────────────────────────
/** Iron Core: ram damage multiplier, and the ram works at ANY momentum. */
export const IRONCORE_RAM_MULT = 3;
/** Turbo Charge: no momentum friction, more steering, quicker feet. */
export const TURBO_STEER_MULT = 1.5;
export const TURBO_WALK_MULT = 1.25;
/** Spring Legs: flat walls BOUNCE >1 while active (compound bouncing). */
export const SPRINGLEGS_RESTITUTION = 1.05;
/** Floor grade S/A unlocks a BONUS VAULT room on the next floor. */
export const BONUS_ROOM_GRADES = ["S", "A"];
