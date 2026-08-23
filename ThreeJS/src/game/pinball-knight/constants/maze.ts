/**
 * Rooms and secret walls. Generator shape lives in maze/, not here.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
// ── Rooms (named archetypes carved into the corridor maze) ──────
/**
 * The backtracker gives corridors; ROOMS give each floor its landmarks. A few
 * rectangular chambers are carved over the maze (pre-thicken, so connectivity
 * is preserved by construction — every cell under a room was already floor)
 * and each is dealt an ARCHETYPE that decorateMaze furnishes:
 *   bumper   → the Bumper Chamber: a cluster of pop bumpers to carom between.
 *   speedway → a lane of dash ramps down the long axis — the launch corridor.
 *   arena    → an open fight pit: extra horde spawns ringing a centre prize.
 *   vault    → the treasure room: two prize items, guarded.
 * Rooms/sizes are in maze CELLS (tiles ≈ cells·2, ×2 again after thickening).
 */
/**
 * TRACK-FIRST generation — grow the circuit, then grow the maze around it.
 *
 * Off = the legacy pipeline (random maze, then trace-and-widen an artery
 * through it). That ordering is why ramps and boosters used to land on corners
 * the ball never takes, and why real curves had nowhere to fit: 81.8% of open
 * tiles had an open radius of ZERO, and radius-4 fillets fitted 4 times across
 * 40 floors (censused in maze/artery-banks.ts).
 *
 * On = maze/track-floor.ts. The flag is kept rather than deleting the old path
 * because the two generators produce very different floors, and being able to
 * A/B them on the same seed is the only honest way to judge a layout change.
 */
export const TRACK_FIRST = true;

/**
 * ARCHETYPE-DRIVEN SURFACE ZONING (maze/surface-paint.ts `paintBands`).
 *
 * Off = the 5x5 surface matrix keeps its single author, the floor modifier —
 * which rolls on 45% of floors from level 3 and paints uniformly at random, so
 * the mechanic is weather and nothing about a floor's SHAPE can ask for a
 * material. On = each archetype also states what its launch district, machine
 * core and drain lane are made of.
 *
 * WHAT "BIT-IDENTICAL" MEANS HERE, because it is the thing to check before
 * touching this: `paintBands` runs on its own derived rng stream, takes zero
 * draws from the generator's, and writes only `Grid.surfaces` — it moves no
 * tile and changes no shape. So flipping this flag leaves every floor's
 * GEOMETRY byte-for-byte identical and changes only what that geometry is made
 * of. `floor-pipeline.test.ts` asserts exactly that, both ways, rather than
 * taking the claim on trust.
 *
 * Default ON. A knob no live path reads is dead however well-tuned it is —
 * that lesson is the reason this wave exists — so shipping the feature switched
 * off would reproduce the defect it was written to fix. The flag stays because
 * an A/B of the same seed with and without materials is the only honest way to
 * judge whether the zoning reads.
 */
export const SURFACE_BANDS = true;

// Rooms are the OPEN "pinball table" space (corridors are 2-wide transit that a
// ball can't really bounce in). Slice 2 (open playfield) makes them bigger and
// more numerous so momentum has room to chain — carveRooms preserves
// connectivity by construction, so this stays solvable.
export const ROOM_MIN_CELLS = 3; // smallest room side, cells (≥6 tiles post-thicken)
export const ROOM_MAX_CELLS = 6; // largest room side, cells (up to 12 tiles — real arenas)
export const ROOMS_BASE = 5; // rooms on level 1 (re-tuned for 4× floor area)
export const ROOMS_PER_LEVEL = 1.2; // +~1 room every ~0.8 depths…
export const ROOMS_MAX = 14; // …capped (full ×4 would dissolve the maze into rooms)

// ── Secret walls (smash through at pinball speed) ───────────────
/**
 * A few wall bands per floor are CRACKED: solid to a walking knight, but hit
 * one carrying pinball momentum ≥ SECRET_BREAK_SPEED and it SHATTERS — opening
 * a shortcut and shaking loot out of the masonry. Every launcher clears the
 * bar (bumper exit 9, ramp 13, spring 16), so any part can be the hammer; a
 * plain walk or a light wall-bounce that has bled below the bar cannot.
 * Cracked bands glint gold so an observant player can hunt them.
 */
export const SECRET_BREAK_SPEED = 7; // u/s of momentum needed to smash through
/**
 * ORDINARY walls also give at TERMINAL speed — carry ≥ this (near ball-form /
 * a hot part chain) into any non-shell wall with a corridor behind it and you
 * KOOL-AID straight through, opening your own shortcut. Set high so it's a
 * reward for a great line, not the default way to travel; the smash costs a
 * big slice of speed so you can't chew a straight line across the whole floor.
 */
export const WALL_BREAK_SPEED = 15;
/** Wall tiles a terminal-speed smash punches through — bands are 2 thick. */
export const WALL_BREAK_DEPTH = 2;
export const WALL_BREAK_SPEED_COST = 0.7; // momentum kept after punching masonry
export const SECRETS_BASE = 4; // cracked walls on level 1 (re-tuned for 4× floors)
export const SECRETS_PER_LEVEL = 1;
export const SECRETS_MAX = 10;
