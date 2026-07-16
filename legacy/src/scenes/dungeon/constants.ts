/**
 * Dungeon — every tuning number lives here.
 */

// ── Render pipeline ─────────────────────────────────────────────
/**
 * Internal render resolution. FIXED — never scales with the window.
 *
 * 1280×720 is the CEL-SHADED round (2026-07-14 playtest: "make the sprites
 * cel shaded instead of this pixel look"): the game is no longer pixel art —
 * actors are smooth vector-drawn cels (see render/cel-painter.ts) and the
 * chunky internal grid was the main thing still reading as "pixels". Every
 * downstream ratio is unchanged: VIEW stays 20×11.25 tiles. The palette
 * quantizer + depth-edge ink outline stay ON — flat banded colour with ink
 * lines IS the cel look; only the resolution and the dither change.
 */
export const RENDER_W = 1280;
export const RENDER_H = 720;

/**
 * Pixels per world unit. RENDER_H / PPU = the ortho frustum height.
 * At 64, one tile (1 world unit) is 64 render pixels.
 */
export const PPU = 64;

export const VIEW_W = RENDER_W / PPU; // 20 tiles across
export const VIEW_H = RENDER_H / PPU; // 11.25 tiles down

/**
 * Cel art scales cleanly (it's smooth shapes, not a pixel grid), so fill the
 * window instead of letterboxing to whole multiples. The snap-to-texel rules
 * (camera + sprites) still apply — they prevent crawl against the fixed
 * render target, which exists at any upscale factor.
 */
export const INTEGER_SCALE = false;

// ── Camera ──────────────────────────────────────────────────────
/**
 * Elevation above the horizon, radians.
 *
 * The angle has been round-tripped by playtests: 35° buried actors behind
 * uniformly tall walls; 50° fixed that but turned the maze into a flat
 * floor-plan of wall TOPS. 38° is the Diablo-ish side view (D2 itself is 2:1
 * dimetric, ~27°) — and it only works because wall height is now STRUCTURAL
 * (see WALL_H/WALL_LOW): the camera-side rim of every corridor is knee-high,
 * so no angle can make a wall cover the corridor behind it.
 */
export const CAMERA_TILT = (38 * Math.PI) / 180;
/**
 * Horizontal rotation — TRUE isometric. At 45° the grid renders as diamonds
 * and every wall shows TWO faces (south + east), which is most of what makes
 * Diablo read as 3D. The camera sits to the world's south-east.
 */
export const CAMERA_YAW = (45 * Math.PI) / 180;
export const CAMERA_DIST = 24; // irrelevant to scale (ortho), just needs to clear geometry

// ── Sprites ─────────────────────────────────────────────────────
/**
 * Cel frames are painted at 128px and displayed at ~70px on the render
 * target — the 2× supersample is what keeps curved outlines smooth after the
 * downscale (drawn at display size they alias visibly).
 */
export const SPRITE_PX = 128; // painted art size per frame, px
export const SPRITE_UNITS = 1.1; // actor plane size, world units (~1 tile tall)

// ── Style toggles (hidden debug keys Q/F/K/O in-game) ───────────
export const QUANTIZE_DEFAULT = true; // snap to the 32-colour palette — banded colour IS cel shading
export const DITHER_DEFAULT = true; // ordered dither breaks AO/shadow banding before the quantizer (2026-07-14 3D pass)
export const SCANLINE_DEFAULT = true; // subtle CRT scanlines — 14% row darkening; A/B'd 2026-07-15, adds arcade-cabinet feel with no readability cost
export const OUTLINE_DEFAULT = true; // depth-edge ink lines (the cel look)

// ── Lighting & depth (the "make the 3D read as 3D" pass) ────────
/**
 * The whole scene used to be lit by a single very-bright flat AmbientLight, so
 * genuine box geometry read as a flat floor-plan: no surface has a light side
 * and a dark side. This pass adds real shape back.
 *
 *  - Surfaces are MeshStandardMaterial with procedural NORMAL MAPS baked from
 *    the same noise that paints the diffuse, so flagstone mortar and wall
 *    courses become lit relief that reacts to the torches you walk past.
 *  - One shadow-casting DirectionalLight (cold, high, raking) gives walls a
 *    cast shadow into the corridors. Its ortho shadow frustum follows the
 *    camera target so a small high-res map covers the whole visible area.
 *  - Ambient drops from the old 4.0 to a level that still keeps unlit stone
 *    off pure black (the quantizer crushes anything darker to void), but low
 *    enough that the directional + torches actually model the geometry.
 */
export const AMBIENT_INTENSITY = 3.5; // readability floor: SOTN is dark in MOOD, never illegible — the quantizer crushes anything dimmer to void
export const HEMI_INTENSITY = 1.1; // sky/ground tint
export const DIR_INTENSITY = 1.5; // the raking cold key light that casts shadows and shapes the normal-mapped stone
/**
 * A dim personal lamp that follows the hero. Not diegetic — it's the
 * Castlevania readability rule: whatever else is dark, the player and the
 * tiles they're about to step on always read.
 */
export const PLAYER_LAMP_INTENSITY = 1.6;
export const PLAYER_LAMP_RANGE = 4.5;
export const DIR_HEIGHT = 14; // how high above the target the sun sits
export const SHADOW_MAP_SIZE = 2048; // per-frame shadow render resolution
/** Half-extent (world units) of the directional light's ortho shadow frustum. */
export const SHADOW_AREA = 16;
/** Shadow darkness: 0 = black shadows, 1 = invisible. Kept soft so it snaps to a stone step, not void. */
export const SHADOW_OPACITY = 0.42;

// ── Atmosphere / fog ────────────────────────────────────────────
/**
 * LINEAR fog in the void colour, keyed on distance-from-camera. It must be
 * linear (near/far), not exponential: under an ortho camera every fragment
 * sits in a narrow distance band (~CAMERA_DIST), so density-based fog would
 * blanket the whole frame uniformly. near/far tuned just past the camera so
 * only the far (upper) end of the view fades into the dark.
 */
export const FOG_NEAR = 30;
export const FOG_FAR = 58;

// ── Bloom (torches / arcane glow bleed light) ───────────────────
/** Luminance above which a pixel is considered "emissive" and blooms. */
export const BLOOM_THRESHOLD = 0.7;
export const BLOOM_STRENGTH = 0.9;
export const BLOOM_RADIUS = 2.2; // blur spread in half-res texels
export const BLOOM_DEFAULT = true;

// ── Screen-space ambient occlusion (folded into the final pass) ──
/** AO sampling radius, in render-target texels. */
export const AO_RADIUS = 14;
export const AO_STRENGTH = 0.85; // how hard concave corners darken
export const AO_DEFAULT = true;

// ── Vignette (modern framing — darkens the screen corners) ──────
export const VIGNETTE = 0.32; // pulled back from 0.5 — it was eating the corners' readability

// ── Sprite pixelation (Phase 2 stopgap — kills the vector look) ──
/**
 * Actor cels are painted as smooth 128px vector art, then CRUSHED to this
 * pixel grid (palette-mapped, nearest-neighbour) before hitting the atlas.
 * That one step turns "flash game" curves into authored-looking pixel art
 * while the sprite-forge pipeline waits for hand-made frames.
 */
export const SPRITE_PIXEL_GRID = 52;

// ── Set dressing density (Phase 1) ──────────────────────────────
/** ~1 in N eligible full-wall faces grows a pilaster / hangs a banner. */
export const PILASTER_EVERY = 5;
export const BANNER_EVERY = 7;
/** ~1 in N eligible corner tiles gets a crate or barrel hugging the wall. */
export const CLUTTER_EVERY = 6;

// ── Torch flames (Phase 3) ──────────────────────────────────────
export const FLAME_FRAMES = 4;
export const FLAME_FPS = 9;

/** Ambient dust motes per second drifting near the player. */
export const MOTE_RATE = 2.2;

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

// ── Animation ───────────────────────────────────────────────────
export const FPS_IDLE = 3;
export const FPS_WALK = 8;
export const FPS_ATTACK = 12;
export const FPS_DEATH = 6;
/** Roll clip: 4 tuck/spin frames across ~ROLL_DURATION (0.42s) → ~10fps. */
export const FPS_ROLL = 10;
/**
 * Run clip base rate — the sprint gait. The ANIMATOR's playback rate is then
 * multiplied by (1 + RUN_RATE_RAMP·sprintCharge) in player.ts, so the run
 * visibly quickens as the spool fills: the animation IS the ramp-up readout.
 */
export const FPS_RUN = 10;
export const RUN_RATE_RAMP = 0.6; // full spool plays the run clip 1.6× faster

// ── World ───────────────────────────────────────────────────────
export const TILE = 1;
/**
 * THE DIABLO WALL TRICK (see BLUEPRINT + boristhebrave's Diablo 1 analysis):
 * Diablo only builds walls on the BACK edges of tiles — the camera-side walls
 * of a room are trimmed. Translated to our 3D maze: a wall tile with walkable
 * floor directly NORTH of it is the south rim of that corridor and would
 * cover it, so it renders KNEE-HIGH (WALL_LOW); everything else renders full
 * (WALL_H) and shows the big south face that makes the scene read as 3D.
 * Occlusion is impossible by construction — no dynamic cutaway needed.
 */
export const WALL_H = 1.1;
export const WALL_LOW = 0.35;

// ── Game loop ───────────────────────────────────────────────────
/**
 * Fixed-timestep simulation (accumulator pattern): logic always steps at
 * 60Hz regardless of display refresh, so movement, attack windows and AI feel
 * identical on a 144Hz monitor and a struggling laptop.
 */
export const FIXED_STEP = 1 / 60;
/** Never simulate more than this per rendered frame (tab-out protection). */
export const MAX_FRAME = 0.1;

// ── Torch light pool ────────────────────────────────────────────
/**
 * Every torch gets a flame mesh, but only the nearest N to the player carry a
 * real PointLight — dozens of live point lights melt a forward renderer, and
 * off-screen torches can't be seen lighting anything anyway.
 */
export const TORCH_LIGHT_POOL = 12;

// ── Player ──────────────────────────────────────────────────────
export const PLAYER_SPEED = 4.2; // tiles/sec
export const PLAYER_R = 0.3; // collision circle radius
export const PLAYER_MAX_HP = 6;
/** After taking a hit you can't be hit again for this long. */
export const PLAYER_IFRAMES = 0.9;

// ── Stamina (the Souls/PoE resource: sprint + dodge both draw on it) ──
/**
 * One shared bar governs sprinting AND dodge-rolling, so you can't infinitely
 * kite a horde — the classic Dark-Souls / Path-of-Exile tension. Regen pauses
 * for a beat after any spend (so a panic-dodge doesn't instantly refund) then
 * pours back. Numbers tuned so: a full bar sprints ~6s, or buys ~3 dodges, and
 * refills from empty in ~2.4s of standing still.
 */
export const STAMINA_MAX = 100;
export const STAMINA_REGEN = 42; // per second, once the delay has elapsed
export const STAMINA_REGEN_DELAY = 0.5; // seconds of no-spend before regen resumes
export const SPRINT_DRAIN = 16; // per second while sprinting
export const DODGE_COST = 28; // per dodge-roll
export const HEAVY_COST = 22; // per heavy swing (light swings are free)

// ── Sprint (hold Shift) ─────────────────────────────────────────
/**
 * Pressing Shift kicks in IMMEDIATELY at SPRINT_BASE_MULT (you feel the gear
 * change the moment you press it — playtest 2026-07-15: a spool that starts at
 * 1.0× read as "shift does nothing"), then the sprint CHARGE lerps you the rest
 * of the way to SPRINT_SPEED_MULT over the 3s ramp. Top gear is dramatic on
 * purpose — the payoff for a sustained run.
 */
export const SPRINT_BASE_MULT = 1.22; // instant multiplier the moment Shift is held
export const SPRINT_SPEED_MULT = 1.85; // top speed multiplier at full sprint charge
/**
 * Walk accel/friction stays snappy (press ≈ full WALK speed almost at once) so
 * ordinary movement is responsive. Sprint is layered on TOP via a separate
 * "sprint charge" that ramps over SPRINT_RAMP_TIME (see below) — that's the
 * gear you have to wind up, not the base walk.
 */
export const MOVE_ACCEL = 22; // units/sec² toward the desired velocity
export const MOVE_FRICTION = 26; // units/sec² decel when no input
/** Camera leads a little further ahead while sprinting (no ortho FOV trick available). */
export const SPRINT_DEADZONE_MULT = 1.4;
/**
 * Sprint is a COMMITMENT you spool up, not an instant toggle. Holding Shift while
 * moving fills a 0→1 "sprint charge" over SPRINT_RAMP_TIME seconds; letting go
 * (or stopping) drains it back over SPRINT_DECAY_TIME. The charge lerps the top
 * speed from walk (1×) toward SPRINT_SPEED_MULT, so full sprint arrives only
 * after a sustained run — and the flashy wall-ride unlocks once the charge is
 * past SPRINT_RIDE_THRESHOLD (halfway up the ramp). Playtest-set to 3s per the
 * "ramp up over 3 seconds to full sprint" request.
 */
export const SPRINT_RAMP_TIME = 3.0; // seconds of sustained run to reach full sprint
export const SPRINT_DECAY_TIME = 0.8; // seconds for the charge to bleed back to 0 when you stop
/**
 * The charge HOLDS for this long before it starts decaying, so a light swing
 * (~0.27s) or clipping a corner mid-run doesn't erase a 3-second spool.
 * Without it, real combat-heavy play never kept any charge and the ramp — and
 * the wall-ride it gates — read as broken (playtest 2026-07-15).
 */
export const SPRINT_GRACE = 0.6;
/** Sprint charge above this (halfway up the ramp, ~1.5s in) unlocks the wall-ride. */
export const SPRINT_RIDE_THRESHOLD = 0.5;
/** Above this charge the walk swaps to the leaning RUN clip. */
export const RUN_CLIP_THRESHOLD = 0.12;

// ── Speed aura (the "he's moving faster" signal) ────────────────
/**
 * A trail of fading AFTERIMAGE ghosts of the knight spawns once the sprint
 * charge passes AURA_MIN_CHARGE — faint and blue at first, GOLD once the spool
 * is full — and during every roll / wall launch. The ghost density scales with
 * charge, so the aura literally thickens as you wind up.
 */
export const AURA_MIN_CHARGE = 0.35;
export const AURA_INTERVAL = 0.11; // seconds between ghosts at minimum charge
export const AURA_LIFE = 0.32; // seconds a ghost takes to fade out
export const AURA_OPACITY = 0.4; // ghost starting opacity
export const AURA_TINT_COOL = 0x6fd0e8; // arcane-blue ghosts while spooling
export const AURA_TINT_HOT = 0xffd23f; // gold ghosts at full sprint
/** Charge at/above this reads as "full" and flips the aura gold. */
export const AURA_HOT_CHARGE = 0.95;

// ── Wall-ride SLIDE (ridable wall, not just the slash) ──────────
/**
 * Sprinting past SPRINT_RIDE_THRESHOLD while hugging a wall is a GRIND: extra
 * speed along the wall face and a spray of torch-coloured sparks off the
 * contact edge. Attack mid-grind for the sweeping WALLRIDE slash; dodge to
 * vault off. The boost only lives while wall contact + charge + Shift all hold.
 */
export const WALLRIDE_SLIDE_BOOST = 1.18; // speed multiplier while grinding
export const GRIND_SPARK_INTERVAL = 0.07; // seconds between spark bursts

// ── PINBALL overcharge (keep sprinting past full spool) ─────────
/**
 * Holding a FULL sprint spool keeps winding: an OVERCHARGE meter builds over
 * OVERCHARGE_TIME. Any overcharge arms PINBALL PHYSICS — the knight carries
 * real momentum and wall hits BOUNCE (reflect + restitution) instead of
 * stopping, ricocheting until he bleeds back below walk-ish speed. At FULL
 * overcharge he tucks into a BALL: faster still, harder bounces, and he RAMS
 * zombies on contact like a wrecking ball. Dodge (Space) bails out instantly.
 */
export const OVERCHARGE_TIME = 2.0; // seconds of full-spool sprinting to fill
export const OVERCHARGE_DECAY = 0.6; // seconds to bleed overcharge once broken
export const PINBALL_RESTITUTION = 0.88; // speed kept per wall bounce
export const PINBALL_FRICTION = 2.0; // u/s² momentum bleed while free-rolling
export const PINBALL_STEER = 3.2; // how hard held input bends the momentum, 1/sec
/** Momentum below this multiple of PLAYER_SPEED exits pinball back to normal control. */
export const PINBALL_EXIT_MULT = 1.05;
export const BALL_SPEED_MULT = 1.35; // extra speed in ball form (on top of full sprint)
export const BALL_RAM_COOLDOWN = 0.3; // seconds between ram hits on the horde
export const BALL_RAM_KNOCKBACK = 0.9; // shove per ram (a wrecking ball, not a tap)
/** Ball clip playback. */
export const FPS_BALL = 14;

// ── Wall moves (Mortal-Kombat-style specials off a wall) ────────
/**
 * With no vertical axis in a top-down grid, "jump off the wall" becomes
 * WALL-CONTACT specials: when the player is pressed against a wall, a short
 * input unlocks a distinct move driven off the existing melee timeline +
 * moveCircle. All are "meaningful but costed" — extra damage, brief i-frames on
 * the launch, and a stamina price, so they're a tactical option near walls, not
 * free flair. wallContact() (collision.ts) supplies the wall NORMAL (the way to
 * kick off toward).
 */
/**
 * How far past the body radius we probe for a wall to count as "wall-adjacent".
 * Generous on purpose (playtest 2026-07-15: at 0.14 you had to be pixel-perfect
 * against the wall for any wall move to arm, which read as "doesn't work").
 */
export const WALL_CONTACT_PROBE = 0.26;
/** Wall-kick: dodge INTO a wall → rebound hop + a lunging light strike away from it. */
export const WALLKICK_COST = 20; // stamina (cheaper than a full dodge)
export const WALLKICK_DURATION = 0.3; // seconds of the launch hop
export const WALLKICK_IFRAMES = 0.16; // invuln over the front of the hop
export const WALLKICK_DISTANCE = 2.2; // tiles launched off the wall
export const WALLKICK: MoveTiming = { windup: 0.04, active: 0.06, recovery: 0.14, damageMul: 1.4, arcMul: 1.2, rangeMul: 1.15, knockbackMul: 1.8, staminaCost: WALLKICK_COST, hitstopMul: 1.3 };
/** Wall-ride: sprint-charged slide along a wall face + a wide sweeping slash. */
export const WALLRIDE_COST = 16;
export const WALLRIDE: MoveTiming = { windup: 0.05, active: 0.08, recovery: 0.16, damageMul: 1.5, arcMul: 1.7, rangeMul: 1.25, knockbackMul: 1.5, staminaCost: WALLRIDE_COST, hitstopMul: 1.5 };
/** Pounce slam: face wall + charge + release → leap arc off the wall to an AoE landing. */
export const POUNCE_COST = 26;
export const POUNCE_DURATION = 0.36; // arc travel time
export const POUNCE_IFRAMES = 0.22; // airborne = untouchable most of the arc
export const POUNCE_DISTANCE = 3.2; // tiles leapt off the wall
export const POUNCE_AOE = 1.6; // radial hit radius on landing (tiles)
export const POUNCE: MoveTiming = { windup: 0.02, active: 0.1, recovery: 0.26, damageMul: 1.9, arcMul: 2, rangeMul: 1, knockbackMul: 2.4, staminaCost: POUNCE_COST, hitstopMul: 2 };

// ── Dodge-roll (tap Space) ──────────────────────────────────────
/**
 * The centrepiece defensive move. Gungeon's roll is ~0.7s with i-frames on the
 * first ~50%; scaled tighter for a faster crawler. The roll COMMITS a direction
 * at the start (input is ignored mid-roll) and i-frames cover only the first
 * ~52% — the back half still moves you but you're hittable, so timing AND aim
 * matter ("roll INTO the attack" to pass through it; roll away and its hitbox
 * can catch you as your i-frames end). Reuses the existing p.iframes guard so a
 * roll and a damage-hit never grant TWO overlapping invuln windows.
 */
export const ROLL_DURATION = 0.42; // seconds of roll body
export const ROLL_IFRAMES = 0.22; // invulnerable window (~52% of the roll)
export const ROLL_DISTANCE = 2.6; // tiles covered, eased fast→slow
export const ROLL_RECOVERY = 0.1; // rooted, vulnerable whiff after the roll body

// ── Attack timing model (windup → active → recovery), per melee move ──
/**
 * Every swing is three phases. Light is fast and free; the combo finisher and
 * the heavy get progressively longer, more telegraphed windups (the "windup
 * scales with weight" readability rule) and hit harder. Times are seconds;
 * the animator plays the matching clip. Per-weapon damage/range/arc still come
 * from items.ts — these are the shared timing anchors.
 */
export interface MoveTiming {
  windup: number; // before the hitbox exists (the tell)
  active: number; // hitbox live
  recovery: number; // rooted after, until you can act
  damageMul: number; // scales the equipped weapon's base damage
  arcMul: number; // widens/narrows the equipped weapon's arc
  rangeMul: number; // reach relative to the weapon
  knockbackMul: number;
  staminaCost: number;
  /**
   * Per-move hit-freeze multiplier over HITSTOP_HIT — the hand-tuned feel dial
   * (deep-research 2026-07-15: Smash tunes hitstop per attack beyond the damage
   * formula — heavies and sweet spots freeze longer, so weight reads on impact).
   * Light ≈ 50ms stays the floor; the heavy lands at ~90ms.
   */
  hitstopMul: number;
}
export const LIGHT_1: MoveTiming = { windup: 0.1, active: 0.05, recovery: 0.12, damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1, staminaCost: 0, hitstopMul: 1 };
export const LIGHT_2: MoveTiming = { windup: 0.08, active: 0.05, recovery: 0.12, damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1, staminaCost: 0, hitstopMul: 1 };
export const COMBO_FINISH: MoveTiming = { windup: 0.12, active: 0.07, recovery: 0.22, damageMul: 1.6, arcMul: 1.35, rangeMul: 1.1, knockbackMul: 2, staminaCost: 0, hitstopMul: 1.4 };
export const HEAVY: MoveTiming = { windup: 0.24, active: 0.08, recovery: 0.28, damageMul: 2.2, arcMul: 1.5, rangeMul: 1.15, knockbackMul: 2.6, staminaCost: HEAVY_COST, hitstopMul: 1.8 };

/** Chain to the next combo step only if the follow-up is pressed within this window after a swing's active frames. */
export const COMBO_WINDOW = 0.34;
/** A charge held past this releases the heavy at max power. */
export const CHARGE_TIME = 0.6;
/** Inputs landed this early still fire (action-game buffering courtesy). */
export const INPUT_BUFFER = 0.13;

// The attack is a short arc in front of the facing direction. The active window
// is tied to the 3-frame 12fps attack clip so the hitbox agrees with the art:
// frame 0 is windup, frame 1 is the swing (active), frame 2 is recovery.
// Per-weapon numbers (damage, range, arc, cooldown, durability) live in
// items.ts — these are just the shared timing anchors.
export const ATTACK_ACTIVE_START = 1 / FPS_ATTACK;
export const ATTACK_ACTIVE_END = 2 / FPS_ATTACK;
export const KNOCKBACK_ZOMBIE = 0.45; // how far a hit shoves a zombie
export const KNOCKBACK_PLAYER = 0.35;

/** Boots multiply run speed by this while equipped. */
export const BOOTS_SPEED_FACTOR = 1.18;

/** Walking within this range of a ground item picks it up. */
export const PICKUP_RANGE = 0.45;
/**
 * A weapon dropped in an exchange can't be re-grabbed until you've stepped
 * this far away from it — otherwise the drop and the pickup ping-pong while
 * you stand on the spot.
 */
export const DROP_CLEAR_RANGE = 0.9;

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
/** Flow-field distance (in tiles) at which a zombie notices you. Once aggroed, always aggroed. */
export const AGGRO_TILES = 9;
/** Zombies shove each other apart below this distance, so a horde doesn't stack into one sprite. */
export const SEPARATION_R = 0.55;
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
export const SPIDER_FROM_LEVEL = 2;

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

// ── Overlord (the mini-boss) ────────────────────────────────────
/**
 * Every BOSS_EVERY floors an OVERLORD guards the stairs: a giant brute with a
 * health bar, a big HP pool that scales with depth, and a guaranteed reward on
 * death. It's the "milestone" — clearing it is how a run of descents feels like
 * progress rather than an endless treadmill. Reuses the brute art (scaled) and
 * the brute's heavy-hit AI.
 */
export const BOSS_EVERY = 5; // a boss on levels 5, 10, 15, …
export const BOSS_BASE_HP = 40;
export const BOSS_HP_PER_TIER = 25; // +this much per boss encounter (level/5)
export const BOSS_SCALE = 1.5; // extra visual size over a normal brute
export const BOSS_SPEED_FACTOR = 0.55;
export const BOSS_GOLD = 50; // bonus gold on kill (on top of per-kill)

// ── RAMPAGE (the FPS ultimate) ──────────────────────────────────
/**
 * The maze is REAL 3D, so the ultimate just swaps the ortho iso camera for a
 * first-person perspective one at eye height and lets you blast down the
 * corridors Doom-style. The pixel/quantize pass stays on, so it reads as a
 * chunky DOS-era FPS. Charges from kills; ends on a timer.
 */
export const ULT_CHARGE_PER_KILL = 0.09; // ~11–12 kills to fill the meter
export const ULT_DURATION = 12; // seconds of rampage per activation
export const FPS_EYE_HEIGHT = 0.62; // camera height above the floor, world units
export const FPS_FOV = 75; // degrees — wide, Wolfenstein-ish
export const FPS_MOVE_SPEED = 5.6; // faster than the iso walk — you're a wrecking ball
export const FPS_TURN_SPEED = 2.6; // radians/sec for keyboard turn (Q/E, arrows)
export const FPS_MOUSE_SENS = 0.0026; // radians per pixel of mouse movement
export const FPS_PITCH_LIMIT = 0.5; // radians up/down clamp
export const FPS_SHOT_COOLDOWN = 0.14; // rapid-fire hitscan
export const FPS_SHOT_DAMAGE = 3; // hitscan damage per shot
export const FPS_SHOT_RANGE = 14; // tiles a hitscan shot reaches

// ── Camera follow ───────────────────────────────────────────────
export const CAM_DEADZONE = 0.7; // player can wander this far before the camera moves
export const CAM_LERP = 6; // catch-up rate, 1/sec

// ── Gold ────────────────────────────────────────────────────────
export const GOLD_PER_KILL = 2;
export const GOLD_PER_DESCENT = 10;

// ── Level scaling ───────────────────────────────────────────────
// One tunable curve: maze size, horde size and zombie speed all step with depth.
export interface LevelConfig {
  cellsW: number; // maze CELLS (tile grid is 2*cells+1)
  cellsH: number;
  zombies: number;
  zombieSpeed: number; // tiles/sec
  torches: number;
  /** Wall-knock probability — higher = more loops/junctions = more complex. */
  braid: number;
}

export function levelConfig(level: number): LevelConfig {
  const l = Math.max(1, level);
  // Cell counts are PRE-thickenWalls: the final tile grid is (2*cells+1)*2.
  // Bigger + faster-growing than the first build so deeper floors are sprawling
  // labyrinths, not the same small maze. Level 1 is ~72×52 tiles; the caps let
  // late floors reach ~120×90.
  const cellsW = Math.min(17 + Math.ceil(l * 1.4), 30);
  const cellsH = Math.min(12 + l, 22);
  const floorTiles = cellsW * cellsH * 8; // ≈ walkable tiles after the 2× scale
  return {
    cellsW,
    cellsH,
    zombies: Math.min(Math.round(floorTiles / 32) + 3 * (l - 1), 60),
    // Faster horde overall, and it ramps harder with depth — a deep floor is a
    // genuine sprint, not a shuffle. (Spiders multiply this again, see items.)
    zombieSpeed: Math.min(1.5 + 0.12 * l, 2.8),
    // Torches ride the maze area too — sparse torches left whole regions
    // pitch dark. Only TORCH_LIGHT_POOL of them are ever LIVE lights.
    torches: Math.min(Math.round(floorTiles / 55) + 8, 40),
    // Braiding grows with depth: shallow floors are corridor duels (few loops),
    // deep floors are open labyrinths full of flanking routes and dead-end
    // ambush pockets. Capped so it never dissolves into an open room.
    braid: Math.min(0.1 + 0.035 * l, 0.32),
  };
}
