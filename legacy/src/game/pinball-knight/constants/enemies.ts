/**
 * The roster: per-kind stats, gates, spawn ratios and the floor timer.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
// ── The Death Dealer (the floor timer) ──────────────────────────
/**
 * Linger too long on one floor and an unkillable REAPER comes for you — the
 * Spelunky ghost, crypt edition. It phases through walls straight at you
 * (ghost movement), accelerates forever, and weapons pass through it: the only
 * answer is the stairs. Exists so the speed kit is eventually mandatory —
 * the game's whole momentum toolbox becomes the escape plan.
 */
export const REAPER_AFTER = 110; // seconds on a floor before it spawns
export const REAPER_WARNING = 15; // warning toast this long before the spawn
export const REAPER_HP = 1; // never actually damaged — immune in combat.ts
export const REAPER_SPEED_BASE = 2.4; // u/s at spawn — a patient drift
export const REAPER_SPEED_RAMP = 0.035; // +u/s every second, forever…
export const REAPER_SPEED_MAX = 6.2; // …capped above walk (4.2), under full sprint
export const REAPER_DAMAGE = 2; // a touch of death, not a nibble
export const REAPER_CONTACT_RANGE = 0.6;
export const REAPER_ATTACK_WINDUP = 0.32;
export const REAPER_ATTACK_COOLDOWN = 1.2;
export const REAPER_SCALE = 1.4; // bigger than the sheet-ghost it reskins
export const REAPER_TINT = 0xd94848; // the ghost sheet dyed blood-red

// ── Bats (fast erratic flyers) ──────────────────────────────────
/**
 * The speed-check enemy: a cave bat that flits at you FAST on a weaving line
 * (sine wobble across its heading), so it's hard to line up but dies to one
 * hit. Flies low through corridors (still wall-bound — it's a cave, not a
 * ghost). Punishes standing still; rewards the spin/ram.
 */
export const BAT_HP = 1;
export const BAT_R = 0.24;
export const BAT_SPEED_FACTOR = 1.9; // fastest thing in the crypt
export const BAT_CONTACT_RANGE = 0.5;
export const BAT_ATTACK_WINDUP = 0.18; // barely a tell — but it only takes 1 hp
export const BAT_ATTACK_COOLDOWN = 1.6; // long recovery after a nip
export const BAT_DAMAGE = 1;
/** Sine weave: amplitude (u) and frequency (rad/s) across the flight line. */
export const BAT_WOBBLE_AMP = 1.6;
export const BAT_WOBBLE_FREQ = 5.5;
export const BAT_HOVER_Y = 0.5;
export const BAT_RATIO = 4;
export const BAT_FROM_LEVEL = 3;

// ── Slimes (split on death) ─────────────────────────────────────
/**
 * The multiplying blob: slow, soaks hits, and on death SPLITS into two minis
 * (fast, 1 HP, smaller). Kill the big one carelessly in a corridor and you've
 * doubled your problem. Minis never split again.
 */
export const SLIME_HP = 4;
export const SLIME_R = 0.34;
export const SLIME_SPEED_FACTOR = 0.55;
export const SLIME_CONTACT_RANGE = 0.66;
export const SLIME_ATTACK_WINDUP = 0.5;
export const SLIME_ATTACK_COOLDOWN = 1.2;
export const SLIME_DAMAGE = 1;
export const SLIME_MINI_HP = 1;
export const SLIME_MINI_SPEED_MULT = 1.7; // minis are quick little panics
export const SLIME_MINI_SCALE = 0.62; // sprite scale for the minis
export const SLIME_RATIO = 6;
export const SLIME_FROM_LEVEL = 3;

// ── Wave-B monsters (pinball-reactive roster — PINBALL_ROADMAP.md) ──
/**
 * BUMPER GOBLIN — round, rubbery, and it treats YOU as the ball: contact
 * kicks the knight away like a pop bumper (no damage — annoyance, not harm).
 * It only takes damage from MOMENTUM hits (ride/ram/ranged-while-riding), so
 * it's the walking tutorial for "hit things fast".
 */
export const GOBLIN_HP = 2;
export const GOBLIN_R = 0.3;
export const GOBLIN_SPEED_FACTOR = 1.2;
export const GOBLIN_KICK_SPEED = 9; // the bounce it hands the player
export const GOBLIN_KICK_COOLDOWN = 0.6;
export const GOBLIN_RATIO = 5;
/**
 * SPORELING — a fungal shambler. Tankier and a shade slower than a zombie, with
 * no special movement: it is a BODY, there to make floor 1 read as a dungeon
 * with more than one thing living in it. Ratio 6 / residue 3 is a free slot in
 * the horde roll (see spawn/factory.ts — every kind claims a distinct
 * `hash % RATIO === n` pair so two kinds never contend for the same slot).
 */
export const SPORELING_RATIO = 6;
export const SPORELING_FROM_LEVEL = 1;
export const SPORELING_SPEED_FACTOR = 0.85;
export const GOBLIN_FROM_LEVEL = 1; // 2→1 playtest 07-23: floor 1 was zombies-only
/**
 * BOWLING PIN CREW — six 1-HP pins spawned in triangle formation. They don't
 * chase; they're SCENERY THAT SCORES: knock one into the rest and the chain
 * reaction takes them down (a shoved pin damages pins it slides into; a wall
 * slam finishes it). 3+ downed inside the strike window = STRIKE bonus.
 */
export const PIN_HP = 1;
export const PIN_R = 0.24;
export const PIN_CREW_SIZE = 6;
export const PIN_SLIDE_DECAY = 3.2; // u/s² friction on a sliding pin
export const PIN_CHAIN_SPEED = 2.2; // sliding faster than this knocks the next pin
export const PIN_SLIDE_FROM_HIT = 7; // slide speed a full knockback hit imparts
export const PIN_STRIKE_WINDOW = 1.6; // seconds for kills to count as one strike
export const PIN_STRIKE_COUNT = 3;
export const PIN_STRIKE_GOLD = 12;
export const PIN_FROM_LEVEL = 1; // 2→1 playtest 07-23: floor 1 was zombies-only
/**
 * BRICK GOLEM — a wall with a temper. Stationary, blocks a corridor, slams
 * anyone who walks close. It only takes damage from a hit carried at
 * SECRET_BREAK_SPEED momentum (same bar as the cracked walls); shattering it
 * sprays ricocheting shards that hurt the horde.
 */
export const GOLEM_HP = 6;
export const GOLEM_R = 0.44;
export const GOLEM_CONTACT_RANGE = 0.95;
export const GOLEM_ATTACK_WINDUP = 0.7;
export const GOLEM_ATTACK_COOLDOWN = 1.6;
export const GOLEM_DAMAGE = 2;
export const GOLEM_SHARDS = 5;
export const GOLEM_SHARD_SPEED = 7;
export const GOLEM_SHARD_DAMAGE = 1;
export const GOLEM_SHARD_LIFE = 1.5; // seconds — shards RICOCHET off walls until this
export const GOLEM_RATIO = 9;
export const GOLEM_FROM_LEVEL = 3;
/**
 * CHOMPER PLANT — a corridor gate with teeth: stationary, snaps fast and hard
 * when you come close. Killable normally, but a momentum hit SHOVES it aside
 * (huge knockback) — speed opens the road without a fight.
 */
export const CHOMPER_HP = 5;
export const CHOMPER_R = 0.36;
export const CHOMPER_CONTACT_RANGE = 0.95;
export const CHOMPER_ATTACK_WINDUP = 0.26; // barely a tell — respect the plant
export const CHOMPER_ATTACK_COOLDOWN = 1.1;
export const CHOMPER_DAMAGE = 2;
export const CHOMPER_RATIO = 7;
export const CHOMPER_FROM_LEVEL = 2;
/**
 * MAGNET CRAWLER — slowly drags the knight toward it. The tether SNAPS when
 * you touch a wall (wall contact breaks the field) or carry real momentum —
 * so the counters are the map itself and speed.
 */
export const MAGNET_HP = 3;
export const MAGNET_R = 0.3;
export const MAGNET_SPEED_FACTOR = 0.5;
export const MAGNET_CONTACT_RANGE = 0.7;
export const MAGNET_ATTACK_WINDUP = 0.45;
export const MAGNET_ATTACK_COOLDOWN = 1.3;
export const MAGNET_DAMAGE = 1;
export const MAGNET_PULL_RANGE = 4.2; // tiles the field reaches
export const MAGNET_PULL = 2.4; // pull velocity at close range, u/s
export const MAGNET_BREAK_SPEED = 8; // momentum above this ignores the pull
export const MAGNET_RATIO = 8;
export const MAGNET_FROM_LEVEL = 3;
/**
 * WEB SPINNER — a spitter variant that shoots sticky WEB instead of acid: no
 * damage, but you're slowed hard until it wears off — or until you touch any
 * pinball part, which shakes the web loose (parts as the cleanse).
 */
export const WEBSPIN_HP = 2;
export const WEBSPIN_R = 0.32;
export const WEBSPIN_SPEED_FACTOR = 0.8;
export const WEB_GLOB_SPEED = 6.5;
export const WEB_SLOW_MULT = 0.45;
export const WEB_TIME = 2.6; // seconds the slow lasts untreated
export const WEBSPIN_RATIO = 7;
export const WEBSPIN_FROM_LEVEL = 4;
/**
 * GHOST MATERIALIZE WINDOW — ghosts are now IMMUNE to damage while drifting
 * (steel passes through ectoplasm); they materialize — and can be hurt —
 * while winding up their touch and for this long after it lands. Fight it
 * when it comes for you; you can't snipe it across the room.
 */
export const GHOST_VULN_TIME = 2.5;

// ── Projectiles (gun / bow / flamethrower) ──────────────────────
/** Where projectiles fly, world Y — chest height on the actors. */
export const PROJECTILE_Y = 0.55;
/** Projectiles spawn this far in front of the player (outside their own body). */
export const MUZZLE_OFFSET = 0.38;
/**
 * A zombie standing in the flame cone touches many puffs at once; after one
 * burn tick it's immune for this long, so the cone reads as a steady ~4/s
 * burn instead of instant incineration.
 */
export const FLAME_BURN_IMMUNITY = 0.24;

// ── Zombies ─────────────────────────────────────────────────────
export const ZOMBIE_R = 0.3;
// 3 HP so weapon damage tiers matter: stick 3 hits, sword 2, mace 1.
export const ZOMBIE_HP = 3;
/** A zombie in contact range winds up, then bites. */
export const ZOMBIE_CONTACT_RANGE = 0.72;
export const ZOMBIE_ATTACK_WINDUP = 0.45;
export const ZOMBIE_ATTACK_COOLDOWN = 1.1;
export const ZOMBIE_DAMAGE = 1;

// ── Zombie SUB-TYPE gaits (zombie-types.ts) ──
/**
 * The HOBBLER's LIMP: its speed oscillates +/-LIMP_AMP around the sub-type's
 * average, so a one-legged zombie lurches and drags instead of gliding at a
 * constant rate. The amplitude has to be large to read at dungeon distance — a
 * 15% wobble is invisible; 60% is a limp.
 */
export const LIMP_AMP = 0.6;
export const LIMP_FREQ = 4.2;
/** The CRAWLER's prone pitch (radians) — tipped onto its belly, not upright. */
export const CRAWLER_PITCH = 1.15;
/**
 * A HULK's collider is ~1.5x a zombie's, wider than a 1-tile corridor tolerates;
 * spawning one there wedges it in rock (the Reaper King bug in a new costume).
 * Below this many open neighbours the spawn falls through to a LURCHER — same
 * "big and slow" beat, with a body that fits.
 */
export const HULK_MIN_OPEN_NEIGHBOURS = 3;

/**
 * Flow-field distance (in tiles) at which a zombie notices you. Once aggroed,
 * always aggroed.
 *
 * ⚠️ A FLOOR-RELATIVE quantity — see `aggroTiles()`. This raw constant is the
 * floor of the range and is no longer read directly by the aggro gate.
 *
 * Why: spawn placement is relative to floor size (`maze/decorate.ts`,
 * `minSpawnDist = max(5, floor(maxDist * 0.3))`), so it doubled when 137f32c
 * quadrupled floor AREA — that commit rescaled zombie counts, torches, rooms,
 * secrets and even FROG_TRAIL_TILES ("scaled with 4× floors"), but left this
 * at 9. The result measured on a live floor 1: median monster sat 53 path
 * tiles from the knight against a radius of 9, so 2.7% of the horde could
 * ever wake and the other 97% stood idle for the whole floor.
 *
 * A bigger fixed number would drift again the next time floors resize, so the
 * radius now DERIVES from the grid the same way the spawn rule does.
 */
export const AGGRO_TILES = 9;

/**
 * The aggro radius for a given floor, in path tiles.
 *
 * Tied to the grid's half-diagonal so it tracks floor size automatically. The
 * 0.45 factor is set against the spawn rule it has to reach: spawns land at
 * ≥ 0.3 × maxDist, and maxDist runs a little under the half-diagonal on these
 * looping-track floors, so 0.45 clears the nearest spawn band with margin
 * while still leaving the far side of the map asleep until you travel to it.
 *
 * Never below AGGRO_TILES — a small floor must not end up with a radius
 * tighter than the hand-tuned original.
 */
export function aggroTiles(gridW: number, gridH: number): number {
  return Math.max(AGGRO_TILES, Math.round(Math.hypot(gridW, gridH) * 0.5 * 0.45));
}
/** Zombies shove each other apart below this distance, so a horde doesn't stack into one sprite. */
export const SEPARATION_R = 0.55;
/**
 * Inside this range a grounded foe abandons the flow field and steers STRAIGHT
 * at the knight. The field only knows tile centres, so door-frame shuffling at
 * close range looks robotic. Was a private const in entities/zombie.ts; it moved
 * here when the steering became a dispatch table (entities/movement.ts), because
 * the baseline every other policy deviates from is a tuning number, not a
 * detail of one function.
 */
export const DIRECT_STEER_RANGE = 1.6;

// ── MOMENTUM GATES → CURVES (DECLONE §6.2) ──────────────────────
/**
 * `soft` for each enemy gate: the fraction of the effect delivered AT the old
 * binary bar. Below the bar it ramps up to this; above it, on to 1 at terminal
 * speed. `soft = 0` would reproduce the old wall exactly (see momentumGate).
 */
/** GOBLIN: rubber. Any momentum at all lands for at least this, ramping to full. */
export const GOBLIN_GATE_SOFT = 0.5;
/** GOLEM: masonry chips below smash-speed instead of ignoring you outright. */
export const GOLEM_GATE_SOFT = 0.25;
/** CRYSTALBACK: a graze throws a shard or two; a full ram throws the reflector. */
export const CRYSTAL_GATE_SOFT = 0.3;
/** CHOMPER: knockback multiplier at terminal speed (was a flat ×3 at any speed). */
export const CHOMPER_SHOVE_MAX = 3;
/** Below this gate factor the blow reads as a CLINK — the teaching moment survives. */
export const GATE_MIN_FACTOR = 0.02;

// ── SUB-TYPE EXCEPTIONS (ZombieTypeDef.exception) ───────────────
/** "dodges-ranged": the fraction of arrows that miss. Entropy, never dice. */
export const DODGE_RANGED_CHANCE = 0.5;
/** "speed-only": the momentumT a KILLING blow needs. Below it, it wears to 1 hp. */
export const SPEED_ONLY_T = 0.45;

// ── BESTIARY MILESTONES (bestiary.ts) ───────────────────────────
/**
 * Kill counts per family that earn a card-affinity tier. Log-ish spacing so the
 * first one lands inside a floor or two (progress must be visible before the
 * screen is worth opening) and the last is a genuine farm.
 */
export const BESTIARY_MILESTONES = [10, 30, 75, 150];
/** Affinity multiplier gained per tier… */
export const BESTIARY_AFFINITY_STEP = 0.25;
/** …and the cap. An uncapped farm bonus makes one family the only one worth killing. */
export const BESTIARY_AFFINITY_MAX = 2;

// ── STAGGER / ENTROPY (entities/stagger.ts) ─────────────────────
/**
 * Doom's pain chance, priced in momentum. See entities/stagger.ts for the why;
 * these are the three numbers the shape needs.
 */
/** What a hit at a dead stop is worth, as a fraction of the family's pain chance.
 *  Small but non-zero, so a heavy weapon still rocks things occasionally — the
 *  rest of the stat is bought with speed. */
export const STAGGER_SPEED_FLOOR = 0.15;
/** Seconds a stagger holds at walking pace… */
export const STAGGER_TIME_MIN = 0.25;
/** …and at terminal speed. A fast hit lands more often AND holds longer. */
export const STAGGER_TIME_MAX = 0.6;
/**
 * The entropy accumulator's trigger threshold (PoE's is 100; the units are
 * arbitrary and only the ratio matters). Chance × this accrues per event; the
 * event fires when the counter crosses it, and the threshold is SUBTRACTED
 * rather than the counter zeroed, so leftover entropy carries and the long-run
 * rate is exactly the printed chance.
 */
export const ENTROPY_FULL = 100;
/** A staggered actor's tint — pale and washed out: it is not in the fight. */
export const STAGGER_TINT = 0xbcbcd0;

// ── MOVEMENT POLICIES (entities/movement.ts) ────────────────────
/**
 * The steering vocabulary's tuning. Every number here answers "how far off the
 * chase line does this intent take you", because a movement type that measures
 * the same as `chase` is a label, not a behaviour — the colocated tests assert
 * exactly that, and these are the knobs they move.
 *
 * All of it rides the EXISTING flow field + moveCircle substrate. Nothing in
 * this block funds a second pathfinder.
 */

/** FLANKER: how far off the direct line it approaches, at full deviation (rad). */
export const FLANK_ANGLE = 1.0; // ~57°, enough to arrive from the side of a corridor mouth
/** Inside this it gives up the angle and commits straight in — it must still land its bite. */
export const FLANK_CLOSE = 1.8;
/** Beyond this the deviation is at FLANK_ANGLE; between the two it fades linearly. */
export const FLANK_FAR = 7.0;

/** STRAFER: the range it wants to hold (world units, floored by its own reach). */
export const STRAFE_RANGE = 3.4;
/** How hard it corrects back onto that range — bigger = looser circle. */
export const STRAFE_BAND = 1.6;
/** Seconds of circling between darts. The cadence IS the tell. */
export const STRAFE_DART_CD = 3.2;
/** Seconds a dart lasts before it drops back to circling. */
export const STRAFE_DART_TIME = 0.85;
/** Speed multiplier while darting — the commit has to look like a commit. */
export const STRAFE_DART_MULT = 1.6;
/** Seconds of hot tint before the dart releases: the window you get to react in. */
export const STRAFE_TELL_LEAD = 0.5;

/** AMBUSHER: it springs when it has line of sight AND you are inside this. */
export const AMBUSH_RANGE = 5.0;
/** Speed multiplier for the opening burst out of hiding. */
export const AMBUSH_BURST_MULT = 1.6;
/** Seconds the burst lasts. After it, it is an ordinary chaser forever. */
export const AMBUSH_BURST_TIME = 1.2;

/** ORBITER: the ring radius it opens at. */
export const ORBIT_RADIUS = 3.6;
/** Radial correction band — bigger = a lazier, wobblier ring. */
export const ORBIT_BAND = 1.2;
/**
 * World units per second the ring TIGHTENS by. An orbiter that held its radius
 * forever would be scenery you can ignore; the spiral makes "it's circling" and
 * "and it's closing" the same readable motion.
 */
export const ORBIT_TIGHTEN = 0.18;

/** LEAPER: it will pounce from inside this range… */
export const LEAP_RANGE = 5.5;
/** …but not from point-blank, where a pounce would just be a walk. */
export const LEAP_MIN_RANGE = 1.2;
/** Seconds of rooted crouch before release. THE window the player reads. */
export const LEAP_WINDUP = 0.45;
/** Seconds the pounce lasts. */
export const LEAP_TIME = 0.5;
/** Speed multiplier during the pounce. */
export const LEAP_SPEED_MULT = 3.4;
/**
 * Radians per second the locked heading rotates during the pounce — this is
 * what makes it an ARC. A straight dash is beaten by one sidestep; an arc bends
 * toward where you were going, so it has to be READ. The heading is locked at
 * crouch-exit and never re-aimed, which is what makes a leap baitable.
 */
export const LEAP_CURVE = 1.5;
/** Seconds of recovery before it may crouch again. */
export const LEAP_CD = 2.2;
/** Speed multiplier while merely closing the gap — it saves itself for the leap. */
export const LEAP_CRUISE_MULT = 0.75;

/**
 * LINE-OF-SIGHT probe (entities/zombie.ts `hasLineOfSight`). Only the ambusher
 * and the leaper ask, and only inside this range — a probe is a walk along a
 * segment and the horde budget is 175 actors.
 */
export const LOS_PROBE_RANGE = 6.0;
/** Sample spacing along the probe. Below a tile, so a doorframe cannot be missed. */
export const LOS_PROBE_STEP = 0.35;

/** PACK-HUNTER: neighbours of the same policy within this count toward the quorum. */
export const PACK_RANGE = 5.5;
/** How many (including itself) it needs before it will engage at all. */
export const PACK_MIN = 3;
/** The range it shadows you at while it waits for numbers. */
export const PACK_HOLD_RANGE = 5.0;
/** Speed multiplier while stalking — it paces you rather than racing you. */
export const PACK_STALK_MULT = 0.5;
/** Speed multiplier once the quorum lands and the whole pack goes at once. */
export const PACK_RUSH_MULT = 1.3;
/** The BFS flow field is recomputed on this cadence, not per frame — one BFS serves every zombie. */
export const FLOW_INTERVAL = 0.25;

// ── Giant spiders ───────────────────────────────────────────────
/**
 * A second enemy family. Fast and fragile: they SKITTER — quicker than a
 * zombie, less HP, a shorter faster bite — so a room of spiders reads very
 * differently from a shambling horde. Same pathing/combat pipeline as zombies
 * (updateZombies handles kind === "spider"), only the numbers + art differ.
 */
export const SPIDER_HP = 2;
export const SPIDER_R = 0.34;
export const SPIDER_SPEED_FACTOR = 1.7; // multiplies the level's zombie speed
export const SPIDER_CONTACT_RANGE = 0.66;
export const SPIDER_ATTACK_WINDUP = 0.28; // snappier than a zombie's lunge
export const SPIDER_ATTACK_COOLDOWN = 0.85;
export const SPIDER_DAMAGE = 1;
/** ~1 spider per this many zombies in the horde, from level SPIDER_FROM_LEVEL. */
export const SPIDER_RATIO = 4;
export const SPIDER_FROM_LEVEL = 1; // 2→1 playtest 07-23: floor 1 was zombies-only

// ── Brutes ──────────────────────────────────────────────────────
/**
 * The tank. Big, slow, soaks a lot of hits and lands a heavy bite that shoves
 * you back hard — you can't just facetank it, you have to kite. Rare, so it's a
 * "oh no, a big one" moment rather than a wall of them. Same pathing/combat as
 * a zombie, just heavy numbers + a bigger body radius.
 */
export const BRUTE_HP = 9;
export const BRUTE_R = 0.42;
export const BRUTE_SPEED_FACTOR = 0.62; // slower than a normal zombie
export const BRUTE_CONTACT_RANGE = 0.85;
export const BRUTE_ATTACK_WINDUP = 0.6; // a slow, telegraphed haymaker
export const BRUTE_ATTACK_COOLDOWN = 1.4;
export const BRUTE_DAMAGE = 2;
export const BRUTE_KNOCKBACK = 0.9; // shoves the player back hard
export const BRUTE_RATIO = 7; // ~1 brute per this many horde slots
export const BRUTE_FROM_LEVEL = 3;

/**
 * How much of a floor's horde is drawn from its BIOME's favoured families
 * (maze/prefabs.ts THEMES.enemies) vs. the base depth cascade. ~55% themed
 * gives each biome a distinct roster read (Warren swarms spiders/slimes,
 * Bloodworks packs brutes/goblins) without erasing the depth-gated staples.
 * A themed pick that's still level-locked just falls through to the cascade.
 */
export const THEME_HORDE_BIAS = 55; // percent, keyed off the spawn hash

// ── Spitters ────────────────────────────────────────────────────
/**
 * The ranged threat. Instead of closing to bite, a spitter stops at range and
 * lobs an acid glob at you (reuses the projectile system). It forces you to
 * break line-of-fire or rush it down — a horde of these plus melee zombies is a
 * real positioning problem. Fragile up close.
 */
export const SPITTER_HP = 3;
export const SPITTER_R = 0.3;
export const SPITTER_SPEED_FACTOR = 0.85;
/** It stops and spits once within this many tiles, instead of closing to melee. */
export const SPITTER_FIRE_RANGE = 6;
/** Below this it panics and keeps its distance rather than getting cornered. */
export const SPITTER_KITE_RANGE = 2.4;
export const SPITTER_WINDUP = 0.55; // the gob is telegraphed — a rear-back
export const SPITTER_COOLDOWN = 1.8;
export const SPITTER_DAMAGE = 1;
export const SPITTER_GLOB_SPEED = 7.5; // tiles/sec
export const SPITTER_RATIO = 6;
export const SPITTER_FROM_LEVEL = 4;

// ── Ghosts (floating wall-phasers) ──────────────────────────────
/**
 * A white sheet-ghost that IGNORES the maze: it floats in a straight line
 * toward the player THROUGH walls (its move never calls moveCircle), bobbing and
 * translucent. You can't corner it or break line-of-sight with geometry — a
 * different pressure than the shambling horde. Fragile (1-2 hits) and slow, so
 * it's a positioning threat, not a bruiser. Silent — no groan.
 */
export const GHOST_HP = 2;
export const GHOST_R = 0.32;
export const GHOST_SPEED_FACTOR = 0.7; // slower than a zombie — a patient drift
export const GHOST_CONTACT_RANGE = 0.68;
export const GHOST_ATTACK_WINDUP = 0.4; // a slow reach-out before the chilling touch
export const GHOST_ATTACK_COOLDOWN = 1.3;
export const GHOST_DAMAGE = 1;
/** How high the ghost hovers (world Y) and its bob amplitude/speed. */
export const GHOST_HOVER_Y = 0.35;
export const GHOST_BOB_AMP = 0.12;
export const GHOST_BOB_SPEED = 2.2;
export const GHOST_RATIO = 5; // ~1 ghost per this many horde slots
export const GHOST_FROM_LEVEL = 2; // start haunting early

// ── Overlord (the mini-boss) ────────────────────────────────────
/**
 * Every BOSS_EVERY floors an OVERLORD guards the stairs: a giant brute with a
 * health bar, a big HP pool that scales with depth, and a guaranteed reward on
 * death. It's the "milestone" — clearing it is how a run of descents feels like
 * progress rather than an endless treadmill. Reuses the brute art (scaled) and
 * the brute's heavy-hit AI.
 */
export const BOSS_EVERY = 5; // every Nth floor the king is a MEGA (double HP)
// Every floor's exit is now boss-gated (live QA ask): the Reaper King guards
// the stairs on EVERY level, HP scaling with depth so floor 1 is a fight a
// starting sword can win. On BOSS_EVERY floors he comes back twice as mean.
export const KING_HP_BASE = 24; // floor-1 king
export const KING_HP_PER_FLOOR = 13; // +per floor below that
export const BOSS_BASE_HP = 40;
export const BOSS_HP_PER_TIER = 25; // +this much per boss encounter (level/5)
export const BOSS_SPEED_FACTOR = 0.55;
export const BOSS_GOLD = 50; // bonus gold on kill (on top of per-kill)
