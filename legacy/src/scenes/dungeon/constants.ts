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

// NB: STAMINA was removed 2026-07-16 ("i don't like that system … more like a
// pinball/sonic system where we want to do crazy combos"). Every move — sprint,
// dodge, wall-kick/ride/pounce, heavy — is now FREE and gated only by cooldowns
// / the sprint spool. The MoveTiming rows below keep no cost field.

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

// ── PINBALL / SONIC momentum (keep sprinting past full spool) ───
/**
 * Holding a FULL sprint spool keeps winding: an OVERCHARGE meter builds over
 * OVERCHARGE_TIME. Any overcharge arms PINBALL PHYSICS — the knight carries real
 * momentum and wall hits BOUNCE.
 *
 * SONIC RULE (2026-07-16, "make it like Sonic … we want crazy combos"): a
 * bounce ADDS speed (restitution > 1) up to PINBALL_MAX_SPEED, so chaining wall
 * hits in a tight corridor ACCELERATES you instead of bleeding out. Momentum
 * only decays (very gently) when you're NOT bouncing, and a bounce COMBO counter
 * climbs per hit for score/damage. At full overcharge he tucks into a BALL:
 * faster, and he RAMS zombies on contact. Dodge (Space) bails out instantly.
 */
export const OVERCHARGE_TIME = 1.4; // seconds of full-spool / bouncing to fill
export const OVERCHARGE_DECAY = 1.0; // seconds to bleed overcharge once fully stopped
/**
 * SKILL-GATED ACCELERATION (2026-07-16, "it can't just infinite loop at max
 * speed … it has to hit certain movements like the corners/physics to speed
 * up"): a FLAT wall bounce PRESERVES speed (restitution just under 1 — you keep
 * your line but never gain by ping-ponging two parallel walls), while a CORNER
 * hit (both axes blocked in the same impact — a genuinely aimed diagonal slam)
 * ACCELERATES you. The other accelerators are the pinball PARTS (bumpers,
 * springs, ramps) — see the PART physics below.
 */
export const PINBALL_WALL_RESTITUTION = 0.94; // flat wall: keep most speed, gain nothing (real pinball walls are 0.1-0.5; this is already generous)
export const PINBALL_CORNER_RESTITUTION = 1.12; // corner pocket: multiply up
export const PINBALL_CORNER_ADD = 1.4; // + a flat kick per corner hit
/** Hard ceiling on pinball momentum — chained corners/parts climb to here, then hold. */
export const PINBALL_MAX_SPEED = 22; // u/s (≈5× walk) — genuinely fast, still steerable
/** Momentum bleed while NOT bouncing — very gentle so a good line stays fast. */
export const PINBALL_FRICTION = 0.9; // u/s² (was 2.0; Sonic keeps its speed)
// Slice 4 — per-surface friction: PINBALL_FRICTION is multiplied by the openness
// of the tile you're on, so OPEN bounce-arenas are a fast highway that holds
// your speed and TIGHT corridors/pockets bleed it for control (speed pacing).
export const FRICTION_OPEN = 0.35; // 3-4 open neighbours (room / junction) — fast
export const FRICTION_CORRIDOR = 1.0; // 2 open (a straight run) — normal
export const FRICTION_TIGHT = 2.1; // ≤1 open (dead-end pocket) — bleeds you down
export const PINBALL_STEER = 3.6; // how hard held input bends the momentum, 1/sec
// Slice 8 — lane glide: while railing fast and not steering, drift toward the
// walkable centre of the corridor so you rail down the middle (pinball lane
// feel) instead of grinding a wall. Lateral units/sec of the centring nudge.
export const LANE_CENTER_PULL = 5.0;
/** How far out (world units) the lane-glide probes for a wall on each side —
 * beyond this it's an open room, so centring backs off. */
export const LANE_PROBE_MAX = 1.8;
/** Momentum below this multiple of PLAYER_SPEED exits pinball back to normal control. */
export const PINBALL_EXIT_MULT = 1.05;
/** Seconds without a bounce before the combo counter resets (keep the chain alive). */
export const PINBALL_COMBO_WINDOW = 1.6;
export const BALL_SPEED_MULT = 1.35; // extra speed in ball form (on top of momentum)
export const BALL_RAM_COOLDOWN = 0.18; // seconds between ram hits on the horde
export const BALL_RAM_KNOCKBACK = 1.1; // shove per ram (a wrecking ball, not a tap)
/** Ball clip playback. */
export const FPS_BALL = 14;

// ── PINBALL PARTS (the maze/pinball-machine hybrid) ─────────────
/**
 * Modular pinball components stamped into the maze by decorateMaze, placed by
 * tile TOPOLOGY so they land where they're useful, not as noise:
 *   BUMPER    → junctions/open crossings: touch it and it KICKS you radially
 *               away, adds speed + a combo tick (the pop bumper).
 *   SPRING    → dead ends, aimed back out: step/roll on and it LAUNCHES you
 *               along its direction at high speed (the plunger).
 *   RAMP      → straight corridors: a dash pad — crossing it floors your speed
 *               along its direction (the Sonic dash panel / slide).
 *   DEFLECTOR → corners: a banked 45° curve — momentum entering the corner is
 *               REDIRECTED around it with no speed loss (the rail/curve).
 * Density scales with depth via PARTS_BASE + PARTS_PER_LEVEL (capped).
 */
// Deep-research 2026-07-16 (disassembly-verified): pop bumpers SET a fixed
// radial velocity (Sonic: magnitude ≈1.2× the run cap, incoming speed ignored)
// — they are NOT restitution>1 reflectors. We keep the incoming speed via a
// flat ADDITIVE kick (never multiplicative — that's what allowed farming), so
// bumper chains build speed linearly toward the cap. ±6° scatter is authentic
// on ACTIVE parts only (plain walls stay mirror-perfect).
export const BUMPER_RADIUS = 0.46; // trigger radius, world units (body-to-centre)
export const BUMPER_KICK_MULT = 1.0; // never multiply the incoming speed…
export const BUMPER_KICK_ADD = 3.2; // …just a flat radial kick per pop (u/s)
export const BUMPER_MIN_EXIT = 9; // even a slow touch leaves at least this fast
export const BUMPER_COOLDOWN = 0.25; // per-bumper re-trigger lockout (s)
export const BUMPER_SCATTER = 0.1; // ±rad (~6°) exit-angle scatter — bumpers only
// Slice 5 — lit bumpers + jackpot: each bumper counts hits; at BUMPER_LIT_HITS it
// LIGHTS (gold, harder kick, bonus gold). Light JACKPOT_BUMPERS of them → a
// jackpot: floor-wide burst damage + gold + flash, then every bumper resets to
// re-light. The pinball scoring loop layered over the existing combo/frenzy glue.
export const BUMPER_LIT_HITS = 3; // pops to light one bumper
export const BUMPER_KICK_LIT = 5.6; // flat kick from a LIT bumper (vs 3.2 unlit)
export const BUMPER_LIT_GOLD = 3; // gold per lit-bumper pop
export const JACKPOT_BUMPERS = 5; // lit bumpers (or all, if fewer) to fire a jackpot
/**
 * LIT SHOT — the "shoot here now" light. While you're carrying real momentum,
 * parts inside a forward cone light up, so the table points at its own shots
 * instead of being a uniformly-lit scatter.
 */
/**
 * BUFF WORLD-TELLS — a buff with a timer must have a LOOK. Rage/Shield/Haste
 * previously existed only as HUD tiles; these drive tinted afterimages and the
 * shield's orbiting motes. Tints match each potion's flask colour.
 */
export const BUFF_TELL_INTERVAL = 0.1; // seconds between tinted afterimages
export const TELL_TINT_RAGE = 0xd97b29;
export const TELL_TINT_HASTE = 0x6fd0e8;
export const TELL_TINT_SHIELD = 0x8fc46b;
export const SHIELD_RING_INTERVAL = 0.13; // cadence of the orbiting bubble motes
export const SHIELD_RING_MOTES = 3; // motes emitted per pulse around the ring
export const SHIELD_RING_RADIUS = 0.55;

/**
 * SHOT IDENTITY (D2-D5) — the layer that turns motion into PLAY. The machine
 * had parts, lights and a combo counter, but every hit was anonymous: five
 * bumper taps scored exactly like ramp → orbit → target-bank. Named shots are
 * what a real table is actually made of. See shots.ts.
 */
/** ROLLOVER lane trigger: generous radius — it's a switch you roll over. */
export const ROLLOVER_RADIUS = 0.46;
export const ROLLOVER_COOLDOWN = 0.5;
/** ORBIT: seconds allowed between corners before a lap is abandoned. */
export const ORBIT_WINDOW = 2.6;
export const ORBIT_GOLD = 30; // a completed lap
export const ORBIT_LAP_BONUS = 15; // each further lap this floor pays this much more
/** ROLLOVER LANES: payout for lighting every lane in one bank. */
export const LANE_CLEAR_GOLD = 25;
/**
 * THE PLUNGER (D4): every floor OPENS by firing the knight into play, aimed at
 * the skill-shot target. A table starts by launching the ball; this floor used
 * to start with you standing still in a deliberately calm corner.
 */
export const PLUNGER_SPEED = 13;
export const PLUNGER_SKILL_RANGE = 26; // how far out a skill target may sit
/** SKILL SHOT: the window off the floor's opening plunger launch. */
export const SKILL_SHOT_WINDOW = 6;
export const SKILL_SHOT_GOLD = 40;
/** How many shot identities are remembered inside one live combo. */
export const NAMED_CHAIN_MAX = 5;

/**
 * NAMED COMBOS — ordered LONGEST FIRST, so the biggest sequence a chain
 * satisfies is the one that pays. Each pays once per floor, which is what
 * keeps hearing its name an event rather than background noise.
 */
export const NAMED_COMBOS: ReadonlyArray<{ name: string; icon: string; shots: string[]; gold: number }> = [
  { name: "GRAND TOUR", icon: "👑", shots: ["ramp", "orbit", "lanes", "bank"], gold: 120 },
  { name: "THE CIRCUIT", icon: "🌀", shots: ["orbit", "orbit"], gold: 90 },
  { name: "LANE RUNNER", icon: "⋯", shots: ["ramp", "lanes"], gold: 60 },
  { name: "ORBIT RUNNER", icon: "↻", shots: ["ramp", "orbit"], gold: 70 },
  { name: "SHARPSHOOTER", icon: "🎯", shots: ["skill", "target"], gold: 55 },
  { name: "BANK JOB", icon: "🏦", shots: ["bank", "bank", "bank"], gold: 50 },
];

export const SHOT_LIGHT_MIN_SPEED = 5; // below this you're walking, not shooting
export const SHOT_LIGHT_RANGE = 14; // world units the light reaches down a lane
export const SHOT_LIGHT_COS = 0.94; // ~20° half-angle cone

export const JACKPOT_GOLD = 45;
export const JACKPOT_DAMAGE = 6; // burst dealt to every enemy on the floor
// Springs are the STRONGEST launcher (research: plunger-class ≈ 2.5-3× top run
// speed, an order of magnitude over a bumper tap in real tables).
export const SPRING_SPEED = 16; // ≈3.8× walk — the big dead-end cannon
export const SPRING_COOLDOWN = 0.6;
// Dash panels follow Sonic's booster rule exactly (disassembly-verified): SET
// the speed as a FLOOR (never slow a faster player) + a short steering lock.
export const RAMP_SPEED = 13; // dash-pad speed floor along its direction
export const RAMP_COOLDOWN = 0.35;
export const RAMP_STEER_LOCK = 0.25; // seconds of no-steer after a dash panel (Sonic's 15 frames)
// ── A2 RAMP HOP — a ramp doesn't just floor your speed, it LAUNCHES you into a
// short ballistic arc that flies OVER wall bands and sets down on the far floor
// (collision bypassed while airborne, like the trapdoor coaster but bite-sized).
// Landing hands the speed to the pinball system, so you bounce if you set down
// against a wall. Walls are 2 tiles thick, so the arc must reach ≥3 tiles to
// clear one — scan a landing in [MIN,MAX] tiles and take the farthest floor.
/**
 * Peak arc height. MUST clear WALL_H (1.1) with daylight to spare — at exactly
 * wall height the knight only grazes the parapet, and only for the single
 * instant at u = 0.5, so a vault read as a scuff. Compare TRAPDOOR_HEIGHT 1.8.
 */
export const RAMP_HOP_HEIGHT = 1.75;
export const RAMP_HOP_MIN = 2.5; // nearest tiles ahead a hop will set down
export const RAMP_HOP_MAX = 4.75; // farthest tiles ahead to look for a landing (clears a 2-thick band + a corridor)
/**
 * VAULT RAMPS — the ones deliberately aimed ACROSS a wall band rather than
 * along the corridor, so the hop actually jumps the maze. Without these every
 * ramp points down its own lane and the airborne arc has nothing to clear.
 */
export const VAULT_RAMPS_PER_FLOOR = 3;
export const RAMP_HOP_SPEED = 16; // u/s the arc travels (governs airtime) — snappy, a touch above RAMP_SPEED
/** Banked curve keeps all your speed and adds a whisper (reward the clean line). */
export const DEFLECTOR_BOOST = 1.03;

// ── Booster pad (Sonic's speed booster — the accelerating LANE element) ──
// Unlike a ramp (a one-shot dash floor), boosters are placed in CHAINS down a
// lane and each one SNAPS your heading to its arrow + floors your speed, so a
// row of them reads as a single accelerating channel you rail down. Works from
// a cold walk too (starts a momentum ride), which is what makes a booster lane
// feel like stepping onto a moving walkway.
export const BOOSTER_SPEED = 15; // speed floor along the arrow (a touch above a ramp)
export const BOOSTER_RADIUS = 0.5; // trigger radius, world units
export const BOOSTER_COOLDOWN = 0.18; // short — a chain must re-fire tile-to-tile
export const BOOSTER_STEER_LOCK = 0.16; // brief lock so the arrow carries you to the next pad

// ── Curved walls (auto-banked maze corners — see collision.computeArcCorners) ──
/** How close to a corner's centre a fast entry banks (world units). */
export const ARC_BANK_RADIUS = 0.62;
/** A swept curve is a return lane, not a pocket: keep speed + a whisper. */
export const ARC_BOOST = 1.03;
/** Re-bank lockout so hugging a corner doesn't machine-gun the redirect. */
export const ARC_COOLDOWN = 0.25;
/** Below this you're just walking a corner — no bank, only the visual. */
export const ARC_MIN_SPEED = 6;
/** Radius of the rendered quarter-cylinder wedge that caps a banked corner. */
export const ARC_WEDGE_R = 0.5;
// ── Cards (cards.ts) — on-hit status tuning + the pinball-synergy speed gate ──
export const CARD_PINBALL_SPEED = 8; // momSpeed above which pinball-synergy cards fire
export const CARD_CHILL_TIME = 2.5; // seconds an enemy stays chilled
export const CARD_CHILL_SLOW = 0.5; // movement multiplier while chilled
export const CARD_BURN_TIME = 3.0; // seconds an enemy burns
export const CARD_BURN_TICK = 0.5; // seconds between burn ticks
export const CARD_BURN_DMG = 1; // damage per burn tick

export const PARTS_BASE = 6; // parts on level 1
export const PARTS_PER_LEVEL = 2; // extra parts per depth…
export const PARTS_MAX = 26; // …capped

// ── Wave-A parts (2026-07-16 pinball build-out — see PINBALL_ROADMAP.md) ──
/**
 * BOXING GLOVE — a wall-mounted piston that fires on its own clock, punching
 * across the corridor. Anything in the lane when it fires gets launched: the
 * PLAYER is flung into a momentum ride (it's a flipper, not a trap — no
 * damage), ZOMBIES take a haymaker + hard knockback. Placed on straight
 * corridor tiles, aimed off the wall it mounts.
 */
export const GLOVE_PERIOD = 2.4; // seconds between punches (jittered per part)
export const GLOVE_ACTIVE = 0.22; // seconds the fist is extended + live
export const GLOVE_LANE_LEN = 1.7; // how far the punch reaches, world units
export const GLOVE_LANE_HALF = 0.55; // lane half-width
export const GLOVE_SPEED = 12; // launch speed handed to the player
export const GLOVE_DAMAGE = 2; // haymaker damage to zombies in the lane
export const GLOVE_KNOCKBACK = 1.6; // and they FLY
/**
 * OIL SLICK — the floor booster: walk onto it while moving and your walk
 * converts into a frictionless momentum slide along your heading; ride over
 * it mid-pinball and it re-greases the ride (no friction, almost no steering)
 * for OIL_SLICK_TIME. The cheap "wheee" part.
 */
export const OIL_RADIUS = 0.72; // slick footprint
export const OIL_LAUNCH_SPEED = 7.5; // minimum slide speed off a walking touch
export const OIL_LAUNCH_MULT = 1.35; // × current speed if that's faster
export const OIL_SLICK_TIME = 0.55; // seconds of zero-friction after contact
export const OIL_STEER_FACTOR = 0.18; // steering authority while slicked
/**
 * SPIN PAD — the slot machine: step on it and it flings you in a RANDOM
 * direction at high speed. Junction furniture; chaos by design.
 */
export const SPINPAD_SPEED = 11;
export const SPINPAD_COOLDOWN = 0.8;
/**
 * SLINGSHOT GATE — two posts with a band between them. Passing through with
 * momentum PINGS you out (×mult + add, min exit); a walking touch launches you
 * along the gate's axis. The double-speed lane.
 */
export const SLING_SPEED_MULT = 1.4;
export const SLING_ADD = 2.2;
export const SLING_MIN_EXIT = 10;
export const SLING_COOLDOWN = 0.5;
/**
 * TARGET BULLSEYES — wall-mounted targets that break when you carry pinball
 * momentum past them. Break ALL of a floor's targets and the machine pays out
 * (gold + a prize dropped at your feet). The floor's objective layer.
 */
export const TARGET_HIT_SPEED = 5; // momentum needed to break one
export const TARGET_RADIUS = 0.62; // trigger distance
export const TARGET_GOLD = 4; // per target
export const TARGET_CLEAR_GOLD = 30; // all-targets payout
// Slice 6 — drop-target BANK: a row of BANK_SIZE targets you must light in 1-2-3
// order (a wrong-order hit resets the bank); completing it pays BANK_CLEAR_GOLD.
export const BANK_SIZE = 3;
export const BANK_CLEAR_GOLD = 25;
export const TARGETS_PER_FLOOR = 5;
/**
 * TRAPDOOR → ROLLERCOASTER — a floor hatch on dead ends, and the floor's ONE
 * AND ONLY way to be moved somewhere you didn't walk to. Step on it: the hatch
 * swings wide (TRAPDOOR_OPEN), you're pulled onto it and fall through
 * (TRAPDOOR_DROP), then the rail takes over — a spline flown OVER the maze
 * walls, control locked, invulnerable — launching you out at spring speed
 * somewhere far. Mechanically a teleport with a ride, so it can't desync
 * combat. Nothing else in the game relocates the knight: pits shove you clear
 * of the rim, and the Magician shuffles the ROOM instead of you.
 */
export const TRAPDOOR_OPEN = 0.22; // hatch swings fully open before the floor gives way
export const TRAPDOOR_DROP = 0.58; // total hatch beat (open + fall through), seconds
export const TRAPDOOR_DROP_DEPTH = 1.5; // how far below the floor you sink before the rail catches you
export const TRAPDOOR_RISE = 0.14; // fraction of the ride spent climbing back out of the hole
export const TRAPDOOR_RIDE_SPEED = 9; // spline traversal speed, u/s
export const TRAPDOOR_RIDE_MIN = 1.6; // ride duration clamp, seconds
export const TRAPDOOR_RIDE_MAX = 3.4;
export const TRAPDOOR_EXIT_SPEED = 14; // momentum handed over on landing
export const TRAPDOOR_HEIGHT = 1.8; // peak flight height over the walls
export const TRAPDOORS_PER_FLOOR = 2;
export const TRAPDOOR_COOLDOWN = 2.5;
/** Bounce-combo part-hits inside one live combo that trigger FRENZY. */
export const FRENZY_PART_HITS = 5;
export const FRENZY_GOLD = 20;

// ── Wave-G parts: flipper + angle mirror (PINBALL_ROADMAP deferred set) ──
/**
 * FLIPPER — a big paddle that FLIPS on contact and launches you along its
 * paddle arc at the strongest speed in the machine (the "real pinball
 * flipper" ask). Placed in open rooms / junctions; the launch direction is
 * the paddle's swing dir. Distinct from the spring (dead-end plunger) by
 * being a room-scale, high-arc catapult with a rotating paddle.
 */
export const FLIPPER_SPEED = 18; // ≈4.3× walk — the hardest single launch
export const FLIPPER_COOLDOWN = 0.7;
export const FLIPPER_RADIUS = 0.6; // contact trigger radius
export const FLIPPER_SWING = 0.22; // seconds the paddle takes to snap up
/**
 * ANGLE MIRROR — a fixed 45°/90° reflector: momentum entering it REFLECTS
 * across the mirror's surface line (unlike the deflector, which banks around
 * a corner). Turns a straight into a bank shot — the puzzle-ricochet piece.
 * mirrorX/Z is the surface DIRECTION (the line the mirror lies along); the
 * reflection normal is its perpendicular.
 */
export const MIRROR_RADIUS = 0.5;
export const MIRROR_COOLDOWN = 0.18;
export const MIRROR_BOOST = 1.02; // a whisper of speed for the clean bank

// ── Wave-H floor hazards (pit / electric / fire vent / magnet strip) ──────
/**
 * PIT — a hole in the floor. Fall in (the coaster is the only thing that
 * clears one) and it costs you a heart, a little gold and all your speed —
 * then you HAUL YOURSELF OUT at the rim you fell in at. It does NOT send you
 * back to the level start: losing the whole floor's progress to one bad bounce
 * in a machine built on ricochets is a punishment, not a hazard. The map's
 * "ouch", not its "start over".
 */
export const PIT_RADIUS = 0.5;
export const PIT_GOLD_PENALTY = 8;
export const PIT_DAMAGE = 1;
export const PIT_CLIMB_COOLDOWN = 1.2; // re-trigger lockout so a rim landing can't loop
/**
 * ELECTRIC GRID — a floor plate that PULSES: dark and safe for ELEC_OFF
 * seconds, then live and lethal-ish for ELEC_ON. Standing on a live plate
 * zaps you (damage + a hard scatter). Rhythm dodge; the plates on one floor
 * share a phase offset so a room reads as a wave.
 */
export const ELEC_RADIUS = 0.5;
export const ELEC_ON = 1.0; // seconds live
export const ELEC_OFF = 1.6; // seconds safe
export const ELEC_DAMAGE = 1;
export const ELEC_ZAP_COOLDOWN = 0.9; // per-plate re-zap lockout
/**
 * FIRE VENT — a wall nozzle that jets a flame LANE across the corridor on a
 * cycle (like the glove, but fire). In the lane while it's roaring → burn.
 * Telegraphed by a sputter before the jet.
 */
export const VENT_PERIOD = 2.6; // seconds between jets (jittered)
export const VENT_WARN = 0.5; // sputter tell before the jet
export const VENT_ACTIVE = 0.7; // seconds the jet roars
export const VENT_LANE_LEN = 2.4; // reach across the corridor
export const VENT_LANE_HALF = 0.5;
export const VENT_DAMAGE = 1;
export const VENT_BURN_COOLDOWN = 0.5; // player re-burn lockout in the jet
/**
 * MAGNET STRIP — a charged floor band that DRAGS on momentum: while you're
 * over it your speed is capped low and steering goes heavy, so a fast line
 * dies in it unless you power through. The anti-speed zone (a foil to oil).
 */
export const MAGSTRIP_RADIUS = 0.55;
export const MAGSTRIP_SPEED_CAP = 3.2; // momentum clamped to this over the strip
export const MAGSTRIP_WALK_MULT = 0.5; // and walking crawls too

/** How many of each hazard a floor rolls (scales gently with depth in core). */
export const HAZARDS_BASE = 3;
export const HAZARDS_PER_LEVEL = 1;
export const HAZARDS_MAX = 10;

// ── Wave-K power-ups: Curve Shot + Magnet Boots ─────────────────
/**
 * CURVE SHOT — for its window, your projectiles CURVE: they bend toward the
 * side your momentum/facing sweeps, arcing around corners. A lateral accel
 * applied each tick perpendicular to the shot's heading.
 */
export const CURVE_TIME = 12;
export const CURVE_ACCEL = 10; // u/s² lateral bend
/**
 * MAGNET BOOTS — inverts the Magnet Crawler's pull to a REPEL and, on a magnet
 * strip, turns the drag into a LAUNCH: momentum tricks off the very things
 * that used to trap you.
 */
export const MAGBOOTS_TIME = 18;
export const MAGBOOTS_REPEL = 3.0; // push strength away from a crawler
export const MAGBOOTS_STRIP_LAUNCH = 12; // speed a strip flings you at instead of dragging

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
// Rooms are the OPEN "pinball table" space (corridors are 2-wide transit that a
// ball can't really bounce in). Slice 2 (open playfield) makes them bigger and
// more numerous so momentum has room to chain — carveRooms preserves
// connectivity by construction, so this stays solvable.
export const ROOM_MIN_CELLS = 3; // smallest room side, cells (≥6 tiles post-thicken)
export const ROOM_MAX_CELLS = 6; // largest room side, cells (up to 12 tiles — real arenas)
export const ROOMS_BASE = 3; // rooms on level 1
export const ROOMS_PER_LEVEL = 0.8; // +~1 room every ~1.25 depths…
export const ROOMS_MAX = 8; // …capped

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
export const SECRETS_BASE = 2; // cracked walls on level 1
export const SECRETS_PER_LEVEL = 0.5;
export const SECRETS_MAX = 5;

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

// ── Floor grade + pinball style bonuses (the score glue) ────────
/**
 * Two rewards that make the machine WORTH playing like a machine:
 *  - STYLE KILLS: a kill landed while carrying pinball momentum pays bonus
 *    gold that scales with the live bounce combo — deflecting off a bumper
 *    into a zombie beats walking up and stabbing it.
 *  - FLOOR GRADE: each descent grades the floor on pace (time), carnage
 *    (horde share killed) and style (best bounce combo), S/A/B/C/D, and pays
 *    a gold bonus. The grade is the "play it again, but cooler" hook.
 */
export const STYLE_KILL_BASE_GOLD = 2; // pinball kill bonus before the combo
export const STYLE_KILL_COMBO_GOLD = 1; // +gold per live bounce-combo step…
export const STYLE_KILL_GOLD_MAX = 12; // …capped per kill
export const GRADE_TIME_FAST = 75; // seconds — under this scores full pace marks
export const GRADE_TIME_OK = 140;
export const GRADE_KILLS_FULL = 0.6; // horde share for full carnage marks
export const GRADE_KILLS_OK = 0.25;
export const GRADE_COMBO_FULL = 8; // best bounce combo for full style marks
export const GRADE_COMBO_OK = 4;
/** Gold paid per grade on descent, S first. */
export const GRADE_GOLD: Record<string, number> = { S: 40, A: 25, B: 15, C: 8, D: 0 };

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
export const GOBLIN_FROM_LEVEL = 2;
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
export const PIN_FROM_LEVEL = 2;
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

// ── Wall moves (Mortal-Kombat-style specials off a wall) ────────
/**
 * With no vertical axis in a top-down grid, "jump off the wall" becomes
 * WALL-CONTACT specials: when the player is pressed against a wall, a short
 * input unlocks a distinct move driven off the existing melee timeline +
 * moveCircle. All hit harder and grant brief i-frames on the launch, and are
 * FREE (no stamina) — a tactical option near walls, always available.
 * wallContact() (collision.ts) supplies the wall NORMAL (the way to kick toward).
 */
/**
 * How far past the body radius we probe for a wall to count as "wall-adjacent".
 * Generous on purpose (playtest 2026-07-15: at 0.14 you had to be pixel-perfect
 * against the wall for any wall move to arm, which read as "doesn't work").
 */
export const WALL_CONTACT_PROBE = 0.26;
/** Wall-kick: dodge INTO a wall → rebound hop + a lunging light strike away from it. */
export const WALLKICK_DURATION = 0.3; // seconds of the launch hop
export const WALLKICK_IFRAMES = 0.16; // invuln over the front of the hop
export const WALLKICK_DISTANCE = 2.2; // tiles launched off the wall
export const WALLKICK: MoveTiming = { windup: 0.04, active: 0.06, recovery: 0.14, damageMul: 1.4, arcMul: 1.2, rangeMul: 1.15, knockbackMul: 1.8, hitstopMul: 1.3 };
/** Wall-ride: sprint-charged slide along a wall face + a wide sweeping slash. */
export const WALLRIDE: MoveTiming = { windup: 0.05, active: 0.08, recovery: 0.16, damageMul: 1.5, arcMul: 1.7, rangeMul: 1.25, knockbackMul: 1.5, hitstopMul: 1.5 };
/** Pounce slam: face wall + charge + release → leap arc off the wall to an AoE landing. */
export const POUNCE_DURATION = 0.36; // arc travel time
export const POUNCE_IFRAMES = 0.22; // airborne = untouchable most of the arc
export const POUNCE_DISTANCE = 3.2; // tiles leapt off the wall
export const POUNCE_AOE = 1.6; // radial hit radius on landing (tiles)
export const POUNCE: MoveTiming = { windup: 0.02, active: 0.1, recovery: 0.26, damageMul: 1.9, arcMul: 2, rangeMul: 1, knockbackMul: 2.4, hitstopMul: 2 };

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
  /**
   * Per-move hit-freeze multiplier over HITSTOP_HIT — the hand-tuned feel dial
   * (deep-research 2026-07-15: Smash tunes hitstop per attack beyond the damage
   * formula — heavies and sweet spots freeze longer, so weight reads on impact).
   * Light ≈ 50ms stays the floor; the heavy lands at ~90ms.
   */
  hitstopMul: number;
}
export const LIGHT_1: MoveTiming = { windup: 0.1, active: 0.05, recovery: 0.12, damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1, hitstopMul: 1 };
export const LIGHT_2: MoveTiming = { windup: 0.08, active: 0.05, recovery: 0.12, damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1, hitstopMul: 1 };
export const COMBO_FINISH: MoveTiming = { windup: 0.12, active: 0.07, recovery: 0.22, damageMul: 1.6, arcMul: 1.35, rangeMul: 1.1, knockbackMul: 2, hitstopMul: 1.4 };
export const HEAVY: MoveTiming = { windup: 0.24, active: 0.08, recovery: 0.28, damageMul: 2.2, arcMul: 1.5, rangeMul: 1.15, knockbackMul: 2.6, hitstopMul: 1.8 };

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
/** Coins (kill drops) are magnetic — within this range they fly to the player, */
export const COIN_MAGNET_RANGE = 2.6;
/** ...easing this fraction of the remaining gap toward the player each frame. */
export const COIN_MAGNET_PULL = 0.22;
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
/**
 * Growing-tree windiness per floor, cycled by depth so consecutive levels never
 * share a maze shape (see generateMaze): 1.0 = winding backtracker corridors,
 * 0.3 = bushy Prim's junctions, 0.65 = a mix. Level 1 stays 1.0 for continuity.
 */
export const WINDINESS_CYCLE = [1.0, 0.3, 0.65];
export interface LevelConfig {
  cellsW: number; // maze CELLS (tile grid is 2*cells+1)
  cellsH: number;
  zombies: number;
  zombieSpeed: number; // tiles/sec
  torches: number;
  /** Wall-knock probability — higher = more loops/junctions = more complex. */
  braid: number;
  /**
   * Growing-tree bias in [0,1] fed to generateMaze: 1 = long winding corridors
   * (recursive backtracker), 0 = bushy many-junction maze (Prim's). Varied by
   * depth so consecutive floors read as structurally different mazes.
   */
  windiness: number;
  /** Archetype rooms carved over the corridors (bumper chamber / arena / …). */
  rooms: number;
  /** Cracked wall bands hiding shortcuts (smash at pinball speed). */
  secrets: number;
  /** A1 — extra break-through bands opened at launch-part runway ends (grow with depth). */
  launchBreaks: number;
}

export function levelConfig(level: number): LevelConfig {
  const l = Math.max(1, level);
  // Cell counts are PRE-thickenWalls: the final tile grid is (2*cells+1)*2.
  // Bigger + faster-growing than the first build so deeper floors are sprawling
  // labyrinths, not the same small maze. Level 1 is ~72×52 tiles; the caps let
  // late floors reach ~134×102. (A3 — the caps rose with the A1 break-throughs:
  // players now carve their own openness, so a floor can start bigger + denser.)
  const cellsW = Math.min(17 + Math.ceil(l * 1.4), 33);
  const cellsH = Math.min(12 + l, 25);
  const floorTiles = cellsW * cellsH * 8; // ≈ walkable tiles after the 2× scale
  // Maze character cycles by depth so no two consecutive floors share a shape:
  // level 1 stays the familiar winding backtracker (1.0), then a bushy
  // junction-heavy floor (0.3), then a mixed one (0.65), repeating. Combined
  // with the rising braid, deep bushy floors become true flanking labyrinths.
  const windiness = WINDINESS_CYCLE[(l - 1) % WINDINESS_CYCLE.length];
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
    braid: Math.min(0.14 + 0.04 * l, 0.4),
    windiness,
    // Rooms + secrets ride depth too: deeper floors are busier theme parks.
    rooms: Math.min(ROOMS_BASE + Math.floor((l - 1) * ROOMS_PER_LEVEL), ROOMS_MAX),
    secrets: Math.min(SECRETS_BASE + Math.floor((l - 1) * SECRETS_PER_LEVEL), SECRETS_MAX),
    // A1 break-through budget: funds both the safety fixes (no boost into an
    // unbreakable wall) and the payoff cracks (a lane that punches through).
    // Grows with depth so deeper floors expand more as you smash outward.
    launchBreaks: Math.min(5 + Math.floor((l - 1) / 2), 10),
  };
}

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
export const FROG_TRAIL_TILES = 30; // how far the mote trail traces
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
