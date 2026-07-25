/**
 * Dungeon — every tuning number lives here.
 */

// ── Render pipeline ─────────────────────────────────────────────
/**
 * The REFERENCE render resolution — the FLOOR, not a fixed size.
 *
 * 1280×720 is the CEL-SHADED round (2026-07-14 playtest: "make the sprites
 * cel shaded instead of this pixel look"): actors are vector-drawn cels (see
 * render/cel-painter.ts) crushed to a hard pixel grid, with the palette
 * quantizer + depth-edge ink outline on top.
 *
 * WHAT CHANGED (2026-07-19). These used to be the LITERAL size of the render
 * target, at every window size, with a FRACTIONAL upscale on top (see
 * INTEGER_SCALE below, now deleted). That was the single biggest source of
 * mush in the whole game: on a 1920×1080 window the upscale was ×1.5, so under
 * `image-rendering: pixelated` every render pixel became alternately 1 or 2
 * screen pixels — an irregular comb across the ENTIRE frame, every sprite,
 * prop and tile at once. The old comment justified it with "cel art scales
 * cleanly (it's smooth shapes, not a pixel grid)"; that premise died when the
 * pipeline started crushing everything to a pixel grid.
 *
 * Now `computeRenderSizing()` in render/pixel-pass.ts DERIVES the render
 * target from the window each resize so the upscale is always a whole number
 * AND the image still fills the screen: it picks the integer zoom from THIS
 * reference, then grows the target to cover the window. So the player never
 * sees LESS than 1280×720 worth of level — but on a window that isn't an exact
 * multiple they do see somewhat MORE (a 1920×1080 window renders 1920×1080 at
 * ×1, i.e. 30×16.875 tiles instead of 20×11.25). That is the deliberate price
 * of "integer scale AND no letterbox AND fixed PPU" — you cannot have all
 * three plus a constant field of view.
 */
export const RENDER_W = 1280;
export const RENDER_H = 720;

/**
 * Ceiling on the derived render target. This is a FIELD-OF-VIEW clamp first and
 * an allocation guard second.
 *
 * Integer scale, a full-screen fill, and a fixed field of view are mutually
 * exclusive — you can have any two. We gave up fixed FOV (see the RENDER_W note
 * above), but unbounded that trade is worse than it sounds: PPU is pinned at
 * 64, so the render width IS the field of view. A 1920-wide target shows 30
 * tiles where the game was designed around 20, which makes every sprite
 * physically SMALLER on screen — the opposite of the fidelity this whole change
 * was chasing, even though each pixel is now perfectly square.
 *
 * 1920×1080 is chosen so the most common desktop size fills the screen at a
 * whole-number scale. The previous 1600×900 was a bad pick: it sat just below
 * 1920, so a 1080p player got 160px bars each side and 90px top and bottom —
 * 31% of the screen black — to buy a framing nobody asked for.
 *
 * Be clear about what integer scaling costs at 1080p, because it is real and
 * there is no way to avoid it: the old fractional path was effectively ×1.5,
 * giving the designed 20 tiles at 96px each. No integer reproduces that. ×1 is
 * 30 tiles at 64px (more level, smaller figures); ×2 is 15 tiles at 128px (big
 * chunky figures, a quarter less warning of what is coming). We took ×1.
 *
 * Past this size the integer scale is KEPT and the canvas letterboxes: crispness is the thing we refuse to
 * trade, and modest bars beat a level that silently zooms out on a big monitor.
 * It also still does the original job — a 7680×1080 ultrawide pins the scale at
 * 1 and would otherwise ask for a 7680-wide target.
 *
 * Raising this re-opens the FOV question; it is not a free "use more of the
 * screen" dial. Must stay EVEN (see the even-size rule in pixel-pass.ts).
 */
export const MAX_RENDER_W = 1920;
export const MAX_RENDER_H = 1080;

/**
 * Pixels per world unit. FIXED at 64 — one tile (1 world unit) is always
 * exactly 64 render pixels, at every window size.
 *
 * This is load-bearing and must NOT be made adaptive: sprite crispness depends
 * on `SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID` (asserted in
 * render/sprite-scale.test.ts), which is what maps one stored art pixel onto
 * one render pixel. The ortho frustum is what flexes with the window instead —
 * pixel-pass.ts resizes it to renderW/PPU × renderH/PPU on every resize.
 */
export const PPU = 64;

/**
 * The REFERENCE view, in tiles — the frustum the camera is BORN with. The live
 * frustum is re-derived from the current render size by pixel-pass.ts, so
 * treat these as the floor (20×11.25 tiles), not as the running value.
 */
export const VIEW_W = RENDER_W / PPU; // 20 tiles across
export const VIEW_H = RENDER_H / PPU; // 11.25 tiles down

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
 * The AUTHORING box. Cel frames are painted at 128px — `cel-painter.ts` and
 * `figure.ts` place every coordinate in this space, so it is a coordinate
 * system, not a resolution, and changing it would move all the art.
 *
 * It is NOT the size the art is stored or displayed at. The paint is crushed
 * once to SPRITE_PIXEL_GRID and the atlas holds it at that size; see
 * `sprite.ts`. The 128px supersample still earns its keep — painting at ~2×
 * the grid is what keeps a curved outline from aliasing when it is downscaled.
 */
export const SPRITE_PX = 128; // painted art size per frame, px

/**
 * The STORED art resolution — the atlas cell size, and the real fidelity dial.
 *
 * The 128px paint is area-downscaled to this grid ONCE, dithered, palette-
 * snapped, and written to the atlas at this size. It is not upscaled back.
 *
 * The old pipeline crushed to 52 and then nearest-upscaled back into a 128px
 * cell (128/52 = 2.46, so the "pixels" were unevenly 2 and 3 px wide inside
 * the texture), which the GPU then minified to ~70px on screen. Three
 * resamplings, two at non-integer ratios, to show 52 pixels of art. Now it is
 * one resample, and 72 texels map 1:1 to 72 screen pixels.
 *
 * 72 rather than 52 is also a real fidelity jump: ~52px is the awkward middle
 * where a face is 2-3 px and reads as mush, while ~72px supports actual facial
 * features, distinct hands and 4-5 shade ramps that hold up. It is the
 * resolution where characters stop looking low-res and start looking
 * deliberately pixel-art. Must stay an integer multiple of PPU's reciprocal —
 * i.e. SPRITE_PIXEL_GRID / PPU must be exact — see SPRITE_UNITS.
 */
export const SPRITE_PIXEL_GRID = 72;

/**
 * Actor plane size, world units.
 *
 * MUST equal SPRITE_PIXEL_GRID / PPU. That identity is the whole ballgame for
 * sprite crispness: it makes one stored art pixel land on exactly one render
 * pixel (72 / 64 = 1.125 units → 1.125 × 64 = 72 px on screen for 72 texels).
 *
 * It used to be 1.1 against a 52px grid, which spanned 70.4 render pixels —
 * a ratio of 1.354. With NearestFilter that means art pixels covering one
 * screen pixel in some places and two in others, in an irregular pattern that
 * shifts as the actor walks. That is what "blurry"/"muddy" actually was: not
 * a soft filter (filtering was already NEAREST) but uneven pixel sizes and
 * destructive undersampling. `sprite.test.ts` asserts the identity so a future
 * edit to either number has to keep it.
 */
export const SPRITE_UNITS = SPRITE_PIXEL_GRID / PPU; // 1.125

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
// 1024, down from 2048: the scene is quantized to a 1280×720 pixel-art target,
// where a 2k shadow map is resolution the eye never sees — but the GPU pays
// for the full depth pass. Combined with the 30 Hz shadow throttle in the
// loop this cuts shadow cost ~8×.
export const SHADOW_MAP_SIZE = 1024; // shadow render resolution
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

// (SPRITE_PIXEL_GRID moved up into the Sprites block — SPRITE_UNITS is now
// derived from it, so it has to be declared first.)

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
/** The tavern one-shots: the gear-hoist flourish and the anvil hammer loop. */
export const FPS_EQUIP = 8;
export const FPS_FORGE = 7;
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
// 6, down from 12: every MeshStandardMaterial fragment loops over ALL live
// point lights, and the pinball floors carry ~150+ materials — halving the
// pool nearly halves the biggest per-pixel cost in the scene. The far half of
// the old pool sat on torches outside the small follow-cam view anyway.
export const TORCH_LIGHT_POOL = 6;

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
export const SPRINT_BASE_MULT = 1.35; // instant multiplier the moment Shift is held
export const SPRINT_SPEED_MULT = 1.85; // top speed multiplier at full sprint charge
/**
 * Walk accel/friction stays snappy (press ≈ full WALK speed almost at once) so
 * ordinary movement is responsive. Sprint is layered on TOP via a separate
 * "sprint charge" that ramps over SPRINT_RAMP_TIME (see below) — that's the
 * gear you have to wind up, not the base walk.
 */
// Tuned up 2026-07-20: at 22/26 there was a ~0.19s spool-up to full walk speed
// on every keypress and a ~0.16s glide on release, which read as "slightly
// sluggish". At 55/42 the ramp is ~0.08s start / ~0.10s stop — taps feel
// immediate while still avoiding the jitter of a hard instant-velocity snap.
export const MOVE_ACCEL = 55; // units/sec² toward the desired velocity
export const MOVE_FRICTION = 42; // units/sec² decel when no input
/** Camera leads a little further ahead while sprinting (no ortho FOV trick available). */
/**
 * Sprint is a COMMITMENT you spool up, not an instant toggle. Holding Shift while
 * moving fills a 0→1 "sprint charge" over SPRINT_RAMP_TIME seconds; letting go
 * (or stopping) drains it back over SPRINT_DECAY_TIME. The charge lerps the top
 * speed from walk (1×) toward SPRINT_SPEED_MULT, so full sprint arrives only
 * after a sustained run — and the flashy wall-ride unlocks once the charge is
 * past SPRINT_RIDE_THRESHOLD (halfway up the ramp). Playtest-set to 3s per the
 * "ramp up over 3 seconds to full sprint" request.
 */
// Playtest 2026-07-23: 3.0s read as "shift does nothing" — the spool now fills
// in 1.5s (and the base gear above is meatier), so Shift visibly kicks.
export const SPRINT_RAMP_TIME = 1.5; // seconds of sustained run to reach full sprint
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
// Playtest 2026-07-23: corners pumped speed faster than pockets could bleed it
// — softened so the ramp is earned over a run, not two ricochets.
export const PINBALL_CORNER_RESTITUTION = 1.08; // corner pocket: multiply up
export const PINBALL_CORNER_ADD = 1.0; // + a flat kick per corner hit
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

// ── Pocket-rattle guard ── ping-ponging inside a dead-end pocket used to hold
// (even GROW) speed forever — the ball got stuck rattling in small gaps with
// the player powerless. If several bounces land inside one small anchor circle
// within a rolling window, each further rattle bleeds momentum hard so control
// returns in under a second.
export const POCKET_RADIUS = 1.4; // world units — "the same small gap"
export const POCKET_BOUNCES = 5; // clustered bounces tolerated before damping
export const POCKET_DAMP = 0.62; // momSpeed multiplier per rattle past the limit
export const POCKET_WINDOW = 1.1; // seconds between bounces that still count as rattling
/**
 * Seconds without a bounce before the combo counter resets (keep the chain
 * alive). This is the ANCHOR/legacy value; the live window is combo-indexed —
 * `comboWindow(n)` in combo-curve.ts shrinks it from COMBO_WINDOW_MAX toward
 * COMBO_WINDOW_MIN as the chain climbs, so a deep combo demands you stay on the
 * track. Kept as the shots.ts chain-alive reference and the reset default.
 */
export const PINBALL_COMBO_WINDOW = 1.6;
export const BALL_SPEED_MULT = 1.35; // extra speed in ball form (on top of momentum)

// ── Progressive combo ramp (combo-curve.ts) ─────────────────────
// The whole ramp is a CONCAVE curve, not the old linear chain: early combos
// pay off urgently, then the gains flatten so 100× never feels like a wall (or
// a lag spike). Every parameter below feeds a pure function in combo-curve.ts;
// see ROUTE_MATH_PLAN-adjacent notes / the combo plan for the derivations.
//
// Part 1 — logarithmic speed ceiling on WALL/CORNER gains (parts still launch
// to their own speeds; the ceiling only caps what bouncing can EARN):
export const COMBO_CEIL_BASE = 8; // u/s the wall-gain ceiling starts at
// Retuned from 0.4/40 after 2-player playtest feedback ("ramps up too quick"):
// K 0.25 flattens the early gains, NSAT 80 doubles the bounces needed to
// approach max — solo speed is now EARNED over a long chain, which is what
// makes the marble-on-marble ×2 (coop.playerCollisions) read as the jackpot.
export const COMBO_CEIL_K = 0.15; // log compression (lower = more gradual; 0.25→0.15 playtest 07-23: ramp too hot)
export const COMBO_CEIL_NSAT = 80; // bounces to ~95% of PINBALL_MAX_SPEED
// Part 3 — restitution taper: the first corner is the most exciting, deep
// corners hold speed but stop gifting it (speed comes from the LINE, not a pop):
export const COMBO_REST_LAMBDA = 0.08; // corner-restitution decay 1.12→1.0
export const COMBO_ADD_MU = 0.06; // corner flat-kick decay 1.4→~0
// Part 4 — the combo window shrinks with depth, then stabilises:
export const COMBO_WINDOW_MAX = 2.2; // generous at low combo (learn the line)
export const COMBO_WINDOW_MIN = 0.9; // tight at high combo (open floor breaks it)
export const COMBO_WINDOW_ALPHA = 0.07; // shrink rate
// Part 5 — global combo friction: at high combo open floor grips a little more,
// biasing toward tight machine routes (gentle: +15% at 100×):
export const COMBO_FRICTION_K = 0.015;
// Part 6 — tiered jackpot gold: +COMBO_GOLD_TIER per doubling of the combo,
// uncapped but logarithmic so mastery always pays and never breaks economy:
export const COMBO_GOLD_TIER = 3;
// Part 2 — tempo zones: Launch (accelerate) → Cruise (flow) → Frenzy (edge):
export const COMBO_ZONE_CRUISE = 8; // enter Cruise: aura goes gold, ball form arms
export const COMBO_ZONE_FRENZY = 30; // enter Frenzy: faster ball, vignette + aberration
export const FRENZY_BALL_SPEED_MULT = 1.6; // ball speed mult while in Frenzy (vs BALL_SPEED_MULT)
export const FRENZY_VIGNETTE = 0.48; // vignette target at full Frenzy (vs VIGNETTE 0.32)
export const FRENZY_ABERRATION = 0.006; // peak chromatic-aberration split (UV units)
export const BALL_RAM_COOLDOWN = 0.18; // seconds between ram hits on the horde
export const BALL_RAM_KNOCKBACK = 1.1; // shove per ram (a wrecking ball, not a tap)
/** Ball clip playback. */
export const FPS_BALL = 14;

// ── MULTI-BALL (the 🔮 potion: two echo knights) ────────────────
/** How many echoes peel off the knight. */
export const MULTIBALL_COUNT = 2;
/** Seconds of player path kept in the follow trail — must exceed the deepest lag. */
export const MULTIBALL_TRAIL_SECONDS = 1.2;
/** Seconds each echo lags behind the live knight (index-aligned with the echoes). */
export const MULTIBALL_LAGS = [0.22, 0.4];
/** World units each echo is nudged sideways off the path, alternating side. */
export const MULTIBALL_SIDE_OFFSET = 0.42;
/** Back-step (seconds) used to read the trail HEADING for the sideways nudge. */
export const MULTIBALL_HEADING_STEP = 0.1;
/** Exponential catch-up rate toward the sampled trail point (per second). */
export const MULTIBALL_FOLLOW_RATE = 16;
/** Fraction of a full ram an echo lands — they assist, they don't replace you. */
export const MULTIBALL_RAM_MULT = 0.5;
/** Seconds an echo must wait before it can ram the SAME enemy again. */
export const MULTIBALL_RAM_COOLDOWN = 0.45;
/** Sprite opacity of an echo — clearly a ghost of you, not a second player. */
export const MULTIBALL_OPACITY = 0.5;

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
 * THE PLUNGER (D4): every floor OPENS parked in a launch chute the player pulls,
 * exactly like a real pinball machine. Hold the dodge key (Space / right-click)
 * to draw the plunger back — power fills over PLUNGER_CHARGE_TIME — while ←/→
 * steer the launch line up to PLUNGER_AIM_MAX off the base lane; release to fire.
 * Launch speed scales from PLUNGER_MIN_SPEED (a soft tap) to PLUNGER_SPEED (a
 * full pull), and a full pull down the base lane lands the SKILL SHOT.
 */
export const PLUNGER_SPEED = 13; // launch speed at full pull (≈3× walk — a cannon)
export const PLUNGER_MIN_SPEED = 6; // a soft tap still fires you into play (≈1.4× walk)
export const PLUNGER_CHARGE_TIME = 0.85; // seconds of full pull to reach max power
export const PLUNGER_AIM_MAX = Math.PI / 6; // ±30° of launch steer off the base lane
export const PLUNGER_AIM_RATE = 1.7; // radians/sec the launch line swings under ←/→
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
/**
 * Tiles the knight reveals around themselves on the floor map.
 *
 * Generous rather than a torch-radius: this is a navigation aid, not a stealth
 * mechanic, and a stingy reveal on a ~134x102 deep floor means the map is empty
 * exactly when it would be most useful.
 */
export const FOG_RADIUS = 6;
export const RAMP_HOP_SPEED = 16; // u/s the arc travels (governs airtime) — snappy, a touch above RAMP_SPEED
/** Banked curve keeps all your speed and adds a whisper (reward the clean line). */
export const DEFLECTOR_BOOST = 1.03;
/** Re-trigger lockout after a bank, so one corner can't fire twice in a frame. */
export const DEFLECTOR_COOLDOWN = 0.3;
// ── Deflector GRAB-THROW (the corner catches the knight and HURLS him) ──
// Instead of a smooth bank, a deflector snaps the ball to its centre, holds it
// for a wind-up beat, then launches it hard around the corner.
/** Seconds the knight is pinned mid-wind-up before the throw fires. */
export const DEFLECTOR_GRAB_TIME = 0.13;
/** The throw is at least this fast (u/s) — a hurl, not a nudge. Floors the
 *  launch so even a slow arrival gets flung; clamped to PINBALL_MAX_SPEED. */
export const DEFLECTOR_THROW_SPEED = 19;
/** …and multiplies whatever you brought in, so a fast entry throws faster. */
export const DEFLECTOR_THROW_BOOST = 1.18;

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
/** Radius of the rendered quarter-cylinder wedge that caps a banked corner.
 *  Bumped 2026-07-20 to match the banked-rail read (was 0.5, buried against the
 *  2-tile wall bands so the real sweepable corners never looked curved). */
export const ARC_WEDGE_R = 0.62;

// ── Curved-wall KICKERS (booster rubber on the sweeps — see maze/arc-sweeps) ──
/**
 * Real tables wrap their curved guides in live rubber: the ball doesn't just
 * bank off a swept wall, it gets THROWN off it. A kicker band is an angular
 * sub-span of an ArcFeature that converts a ricochet into a bumper-grade kick.
 * Tuned against the bumper (BUMPER_KICK_ADD 3.2 / BUMPER_MIN_EXIT) so a wall
 * kicker reads as the same family of accelerator, slightly softer — it is free
 * and unavoidable on the sweep, where a bumper has to be aimed at.
 */
/** Never multiplies the incoming speed — a flat kick, like a bumper. */
export const ARC_KICK_MULT = 1.0;
/** Flat speed added on top of the reflection (u/s). */
export const ARC_KICK_ADD = 2.6;
/** Speed floor leaving the rubber — a slow graze still gets flung. */
export const ARC_KICK_MIN_EXIT = 9;
/** Below this, contact is a lean, not a hit: bank normally, no kick, no flash. */
export const ARC_KICK_MIN_SPEED = 3.5;
/** Authentic ±rad exit scatter, same rule as bumpers (active parts scatter). */
export const ARC_KICK_SCATTER = 0.1;
/** Re-fire lockout so hugging the band can't machine-gun it. */
export const ARC_KICK_COOLDOWN = 0.3;
/** Gold paid per kick — small; the payout is the SPEED, not the purse. */
export const ARC_KICK_GOLD = 1;
/** Seconds the rubber stays visibly compressed + lit after a kick. */
export const ARC_KICK_FLASH = 0.26;
/** How far the rubber stands proud of the collider face (world units). */
export const ARC_KICK_THICK = 0.07;
// ⚠️ DEAD MIRRORS — the five below are NOT read by anything. maze/arc-sweeps.ts
// declares its own copies (KICK_BAND_FRAC/KICK_CHANCE/KICK_ISLAND_BANDS/
// KICK_ISLAND_SPAN/KICK_MAX_PER_FLOOR) and never imports these, so editing them
// changes nothing. Tune the ones in arc-sweeps.ts. Kept only because deleting
// exports is a wider blast radius than labelling them.
/** Fraction of a fillet sweep's span the band covers (centred on the arc). */
export const ARC_KICK_BAND_FRAC = 0.62;
/** Chance a qualifying fillet sweep is authored with rubber. */
export const ARC_KICK_CHANCE = 0.45;
/** Bands strung evenly around an orbit island, and each one's width (rad). */
export const ARC_KICK_ISLAND_BANDS = 3;
export const ARC_KICK_ISLAND_SPAN = 0.62;
/** Hard cap per floor — a machine, not a trampoline. */
export const ARC_KICK_MAX = 10;

// ── Curved-wall BOOSTER LANES (speed strips ON the sweeps — arc-sweeps.ts) ──
/**
 * A lane is the OTHER thing a curved guide can do. Rubber (above) is a RADIAL
 * accelerator — it throws the ball off the wall. A lane is TANGENTIAL: roll into
 * the bend with its grain and it sweeps you around and spits you out ALONG the
 * curve, faster than you came in. That is the "curved booster lane" feel — a
 * banked corner you take at speed, not a trampoline you bounce off.
 *
 * Deliberately stronger than a kick (ADD 3.4 vs 2.6): a lane only fires when you
 * are already running its way, so it rewards a line the player chose, where
 * rubber fires on any contact at all. The exit is the arc's live tangent, so the
 * ball leaves following the wall it just rode.
 */
/** Multiplies incoming speed — a lane COMPOUNDS a good line, unlike flat rubber. */
export const ARC_LANE_MULT = 1.12;
/** Flat speed added on top of the multiply (u/s). */
export const ARC_LANE_ADD = 3.4;
/** Speed floor leaving a lane — entering slow still leaves you moving. */
export const ARC_LANE_MIN_EXIT = 10;
/** Below this, a lane is just a wall to lean on: no boost, no flash. */
export const ARC_LANE_MIN_SPEED = 3;
/** Re-fire lockout — long enough that one sweep is one boost, not a grind. */
export const ARC_LANE_COOLDOWN = 0.45;
/** Gold paid per boost — the payout is the LINE, not the purse. */
export const ARC_LANE_GOLD = 2;
/** Seconds the strip stays lit after a boost. */
export const ARC_LANE_FLASH = 0.34;
/** How far the strip stands proud of the collider face (world units). */
export const ARC_LANE_THICK = 0.05;
// ── Cards (cards.ts) — on-hit status tuning + the pinball-synergy speed gate ──
export const CARD_PINBALL_SPEED = 8; // momSpeed above which pinball-synergy cards fire
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
export const OIL_COOLDOWN = 0.4; // re-trigger lockout after a slick launch
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
 * GRAVE PIT — the lethal hole torn open where a knight left the pool.
 *
 * Wider than a normal pit and LETHAL (see fallInGravePit). The extra radius is
 * not just menace: this hazard appears mid-run with no warning, so it has to be
 * seen from further away than the furniture a player walked past on arrival.
 */
export const GRAVEPIT_RADIUS = 0.66;
/** Seconds the detonation's shockwave keeps damaging, before the hole settles. */
export const GRAVEPIT_BLAST_LIFE = 0.5;
/** Radius the departing knight's blast reaches (world units). */
export const GRAVEPIT_BLAST_RADIUS = 2.4;
/** Damage the blast deals to ENEMIES caught in it (players are never hurt by
 *  it — the hole is the threat, and a hit at spawn time would be unavoidable). */
export const GRAVEPIT_BLAST_DAMAGE = 3;
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
// Duration lives on POTIONS.curveshot in items.ts (the owner of every potion's
// duration) — it was duplicated here and the copy was wired to nothing.
export const CURVE_ACCEL = 10; // u/s² lateral bend
/**
 * MAGNET BOOTS — inverts the Magnet Crawler's pull to a REPEL and, on a magnet
 * strip, turns the drag into a LAUNCH: momentum tricks off the very things
 * that used to trap you.
 */
// Duration lives on POTIONS.magnetboots in items.ts (see CURVE_ACCEL above).
export const MAGBOOTS_REPEL = 3.0; // push strength away from a crawler
export const MAGBOOTS_STRIP_LAUNCH = 12; // speed a strip flings you at instead of dragging
export const MAGSTRIP_BOOTS_COOLDOWN = 0.4; // lockout after a boots-inverted strip launch

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
/**
 * A roll is a MOMENTUM move now: you must already be moving at least this fast
 * (smoothed walk speed, units/sec) to convert into a tumble. Rolling from a dead
 * stop is out — you can't dodge-cannon the instant a floor's plunger parks you,
 * you have to get the knight rolling first. ~0.6× PLAYER_SPEED, so a beat of
 * running arms it; standing still or barely nudging does not.
 */
export const ROLL_MIN_SPEED = 2.5;

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
// The chain ACCELERATES: each step is shorter than the last (and player.ts
// ramps the clip rate to match), so mashing visibly speeds up into the finisher.
export const LIGHT_1: MoveTiming = { windup: 0.1, active: 0.05, recovery: 0.12, damageMul: 1, arcMul: 1, rangeMul: 1, knockbackMul: 1, hitstopMul: 1 };
export const LIGHT_2: MoveTiming = { windup: 0.06, active: 0.05, recovery: 0.09, damageMul: 1.15, arcMul: 1.15, rangeMul: 1.05, knockbackMul: 1.1, hitstopMul: 1.1 };
// The finisher is the KATANA moment (white flash, triple cut, cut-through
// ghosts — see player.ts) so it hits like a payoff: 2× damage, a genuinely wide
// arc and the heaviest non-heavy hitstop in the kit.
export const COMBO_FINISH: MoveTiming = { windup: 0.11, active: 0.07, recovery: 0.16, damageMul: 2.0, arcMul: 1.6, rangeMul: 1.25, knockbackMul: 2, hitstopMul: 1.8 };
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
export const KNOCKBACK_ZOMBIE = 0.45; // how far a hit shoves a zombie
export const KNOCKBACK_PLAYER = 0.35;

/** Boots multiply run speed by this while equipped. */
export const BOOTS_SPEED_FACTOR = 1.18;

/** Walking within this range of a ground item picks it up. */
export const PICKUP_RANGE = 0.45;

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
  /** ≈ walkable tiles after the 2× thicken — the area every density budget rides. */
  floorTiles: number;
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
  // labyrinths, not the same small maze. 4× AREA (2× per side) since the route
  // plan rework: level 1 is ~150×106 tiles; the caps let late floors reach
  // ~266×202 (~54k tiles). Counts that should ride the area do so via
  // floorTiles below; hard caps were re-tuned for the new area — see
  // ROUTE_MATH_PLAN.md §10 for what scales, what's hand-set, and the perf
  // watchlist (zombie draw calls, flow-field O(tiles)).
  const cellsW = Math.min(34 + Math.ceil(l * 2.8), 66);
  const cellsH = Math.min(24 + 2 * l, 50);
  const floorTiles = cellsW * cellsH * 8; // ≈ walkable tiles after the 2× scale
  // Maze character cycles by depth so no two consecutive floors share a shape:
  // level 1 stays the familiar winding backtracker (1.0), then a bushy
  // junction-heavy floor (0.3), then a mixed one (0.65), repeating. Combined
  // with the rising braid, deep bushy floors become true flanking labyrinths.
  const windiness = WINDINESS_CYCLE[(l - 1) % WINDINESS_CYCLE.length];
  return {
    cellsW,
    cellsH,
    floorTiles,
    // Cap re-tuned for 4× floors: at the old 60 the density would drop 4× and
    // big floors would read empty. 110 is a DRAW-CALL budget as much as a
    // difficulty one — each zombie is its own sprite mesh; raise with care.
    zombies: Math.min(Math.round(floorTiles / 26) + 3 * (l - 1), 135), // densified after co-op QA ("not enough monsters") — packs land on top of this
    // Faster horde overall, and it ramps harder with depth — a deep floor is a
    // genuine sprint, not a shuffle. (Spiders multiply this again, see items.)
    zombieSpeed: Math.min(1.5 + 0.12 * l, 2.8),
    // Torches ride the maze area too — sparse torches left whole regions
    // pitch dark. Only TORCH_LIGHT_POOL of them are ever LIVE lights.
    torches: Math.min(Math.round(floorTiles / 55) + 8, 80),
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
    launchBreaks: Math.min(8 + Math.floor((l - 1) / 2), 16),
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

// ── MARBLE MATERIALS ────────────────────────────────────────────
// A second "ball" axis: what the pinball is MADE OF. Modifies ride physics at
// the same choke points that branch on springT/turboT/oilT, plus on-bounce and
// on-slam emitters. See entities/marble.ts and state.MarbleMaterial.
/** How long a picked-up material lasts (seconds), by material. */
export const MATERIAL_DURATION = { diamond: 20, water: 16, stone: 24, storm: 16, shadow: 12, lava: 14 } as const;
/** Fusion window: after a 2nd pickup, both materials co-fire this long. */
export const MATERIAL_FUSION_TIME = 2;
/** Min momentum (u/s) before a bounce emits anything — rewards flow, kills spam. */
export const MATERIAL_EMIT_SPEED = 6;
/** Min seconds between on-bounce emissions. */
export const MATERIAL_EMIT_COOLDOWN = 0.12;

// 💎 Diamond — offense / projectiles
export const DIAMOND_RESTITUTION = 1.0; // perfectly elastic flat walls
export const DIAMOND_WALL_BREAK_SPEED = 8; // was WALL_BREAK_SPEED 15
export const DIAMOND_SECRET_BREAK_SPEED = 4; // was SECRET_BREAK_SPEED 7
export const DIAMOND_BOUNCE_SHARDS = 4; // shards per qualifying bounce
export const DIAMOND_BOUNCE_FAN = 0.7; // ±rad fan around the ricochet vector (~40°)
export const DIAMOND_BOUNCE_DMG = 1;
export const DIAMOND_SLAM_SHARDS = 8; // radial burst on pounce slam
export const DIAMOND_SLAM_SPEED = 12; // u/s
export const DIAMOND_SLAM_DMG = 2;
export const DIAMOND_SHARD_SPEED = 14; // u/s of an on-bounce shard

// 💧 Water — fast & slippery (mobility / flow)
export const WATER_RESTITUTION = 0.98; // keeps almost all speed
export const WATER_FRICTION_MULT = 0.08; // near-frictionless glide (permanent-oil feel)
export const WATER_STEER_MULT = 0.55; // slippery: weak grip, momentum-dominated
export const WATER_RAM_KNOCKBACK = 0.2; // flows through, barely shoves
export const WATER_SLICK_RADIUS = 0.7; // tile radius of a slick scar
export const WATER_SLICK_LIFE = 4; // seconds a slick persists
export const WATER_SLAM_SLICKS = 5; // slick patches thrown on slam
export const WATER_SLAM_SPEED_KICK = 4; // u/s forward kick on slam
export const WATER_SLIP_TIME = 0.8; // seconds an enemy slides after touching slick
export const WATER_SLIP_SPEED = 2.4; // u/s an enemy drifts while slipping

// 🪨 Stone — force / area-denial
export const STONE_RAM_KNOCKBACK = 3.3; // was BALL_RAM_KNOCKBACK 1.1
export const STONE_FRICTION_MULT = 1.6; // rolls, doesn't glide
export const STONE_MAX_SPEED = 16; // lower ceiling (vs PINBALL_MAX_SPEED 22)
export const STONE_BUMPER_KICK_MULT = 0.15; // ignores small bumper forces
export const STONE_CORNER_ADD_MULT = 3; // corner hits accelerate harder
export const STONE_SHOCK_RADIUS = 0.6; // on-bounce shockwave radius (tiles)
export const STONE_SHOCK_DMG = 1;
export const STONE_SHOCK_GOLEM_MULT = 2; // stone bullies golems
export const STONE_SLAM_RADIUS = 1.4; // boulder-slam AoE
export const STONE_SLAM_BASE_DMG = 4;
export const STONE_SLAM_DMG_PER_SPEED = 0.3; // + this × speed converted

// ── MATERIAL × TERRAIN REACTIONS ──
// The ball's substance reacts to hazard tiles it crosses (see entities/marble.ts
// materialTerrain* + the pinball-collide / hazards handlers that call them).
// 💧 Water × magstrip → STEAM ERUPTION (the anti-speed trap flash-boils into a
//    launch + a scalding radial burst instead of dragging you to a crawl).
export const WATER_STEAM_LAUNCH = 14; // u/s the eruption flings you (vs the crawl)
export const WATER_STEAM_RADIUS = 2.0; // scald radius (tiles)
export const WATER_STEAM_DMG = 3;
export const WATER_STEAM_COOLDOWN = 0.5; // per-strip re-arm
// 🪨 Stone × magstrip → PLOW: too heavy for the field to grip; barely slowed.
export const STONE_MAGSTRIP_CAP = 13; // speed clamp for stone (vs MAGSTRIP_SPEED_CAP 3.2)
// 💎 Diamond × electric → DISCHARGE: prismatic lattice channels a live plate
//    into a zap on nearby foes, and diamond eats the shock itself.
export const DIAMOND_DISCHARGE_RADIUS = 2.4;
export const DIAMOND_DISCHARGE_DMG = 4;

// ⚡ Storm — corridor rails / lightning (mobility + electric offense)
export const STORM_LANE_PULL_MULT = 2.0; // rails corridors with inhuman precision
export const STORM_STEER_MULT = 1.45; // sharper mid-flight response
export const STORM_BOUNCE_ARC_DMG = 2; // sideways zap on each fast bounce
export const STORM_BOUNCE_ARC_LEN = 3.2; // arc reach (blocks)
export const STORM_BOUNCE_ARC_HALF = 0.9; // arc half-width band
export const STORM_CLAP_RADIUS = 3.0; // thunderclap ring (slam)
export const STORM_CLAP_DMG = 3;
export const STORM_CLAP_STUN = 0.6; // seconds a foe is stunned (frozen in place)
// Storm × water-slick → ELECTRIFIED FLOOR: a storm bounce over a wet tile
// discharges into everything standing on any slick, chaining the shock.
export const STORM_WET_DMG = 2;

// 🌑 Shadow — evasion / control (slips gaps, decoys, void implosion)
export const SHADOW_PLAYER_R = 0.21; // shrunk collider (vs PLAYER_R 0.3) — slips tight gaps
export const SHADOW_RESTITUTION = 1.05; // flat walls slowly ACCELERATE — slippery unreality
export const SHADOW_BUMPER_SCATTER_MULT = 2.0; // bumper exits get unpredictable
export const SHADOW_LURE_RADIUS = 4.0; // foes this close get pulled onto the decoy
export const SHADOW_LURE_TIME = 1.2; // seconds a foe chases the shadow clone
export const SHADOW_IMPLODE_RADIUS = 4.2; // void-implosion reach (slam)
export const SHADOW_IMPLODE_PULL = 0.45; // fraction of the way to you a foe is yanked
export const SHADOW_IMPLODE_DMG = 2; // collision damage as they crush together

// 🔥 Lava — terrain scorcher (leave the machine burning)
export const LAVA_BUMPER_MULT = 1.6; // reactive off parts — explosive bumper kicks
export const LAVA_SLAM_GLOBS = 6; // fire puddles thrown in a ring on the slam
export const LAVA_SLAM_FIRE_RADIUS = 0.9;
export const LAVA_SLAM_FIRE_LIFE = 3;

// Floor-fx (persistent scars)
export const FLOORFX_TICK = 0.4; // seconds between floor-fx damage/status ticks
export const FIRE_PUDDLE_DMG = 1; // per tick (deferred Lava; wired for R&D)
export const FIRE_PUDDLE_LIFE = 3;
export const FIRE_PUDDLE_RADIUS = 0.8;
export const MATERIAL_SELF_HARM_DMG = 1; // player dmg per tick on own hazard (toggle)

// ══ EXPANSION ROSTER (CONTENT_EXPANSION_PLAN.md) ══════════════════
// Reuse existing sprite sheets (tinted) — art is borrowed; behavior is bespoke.
// 🐕 Hound — charger
export const HOUND_HP = 3;
export const HOUND_R = 0.3;
export const HOUND_CONTACT_RANGE = 0.75;
export const HOUND_ATTACK_WINDUP = 0.3;
export const HOUND_ATTACK_COOLDOWN = 1.4;
export const HOUND_SPEED_FACTOR = 1.35;
export const HOUND_FROM_LEVEL = 1; // 2→1 playtest 07-23: floor 1 was zombies-only
export const HOUND_CHARGE_RANGE = 5.5; // starts a charge when you're in this range + line
export const HOUND_CHARGE_WINDUP = 0.45; // telegraph before the dash
export const HOUND_CHARGE_SPEED = 10; // dash speed (tiles/s)
export const HOUND_CHARGE_TIME = 0.5; // dash duration
export const HOUND_CHARGE_DMG = 3;
// 🤢 Bloater — exploder
export const BLOATER_HP = 6;
export const BLOATER_R = 0.4;
export const BLOATER_CONTACT_RANGE = 0.7;
export const BLOATER_ATTACK_WINDUP = 0.4;
export const BLOATER_ATTACK_COOLDOWN = 2;
export const BLOATER_SPEED_FACTOR = 0.62;
export const BLOATER_FROM_LEVEL = 3;
export const BLOATER_BURST_RADIUS = 1.6; // fire puddle radius left on death
// 💀 Necromancer — summoner
export const NECRO_HP = 4;
export const NECRO_R = 0.32;
export const NECRO_CONTACT_RANGE = 4.5; // ranged: kites like a spitter
export const NECRO_ATTACK_WINDUP = 0.5;
export const NECRO_ATTACK_COOLDOWN = 2;
export const NECRO_SPEED_FACTOR = 0.8;
export const NECRO_FROM_LEVEL = 4;
export const NECRO_SUMMON_CD = 4.5; // seconds between raising an add
export const NECRO_SUMMON_MAX = 6; // don't summon past this live-horde count nearby
// 🛡 Warden — shielder
export const WARDEN_HP = 8;
export const WARDEN_R = 0.4;
export const WARDEN_CONTACT_RANGE = 0.8;
export const WARDEN_ATTACK_WINDUP = 0.5;
export const WARDEN_ATTACK_COOLDOWN = 1.6;
export const WARDEN_SPEED_FACTOR = 0.7;
export const WARDEN_FROM_LEVEL = 4;
export const WARDEN_SHIELD_RADIUS = 3.5;
export const WARDEN_SHIELD_HP = 3; // absorb granted to each nearby foe
export const WARDEN_PULSE_CD = 3; // re-shield cadence
// 🔮 Wisp — evasive
export const WISP_HP = 2;
export const WISP_R = 0.28;
export const WISP_CONTACT_RANGE = 0.7;
export const WISP_ATTACK_WINDUP = 0.3;
export const WISP_ATTACK_COOLDOWN = 1.2;
export const WISP_SPEED_FACTOR = 1.0;
export const WISP_FROM_LEVEL = 3;
export const WISP_BLINK_DIST = 2.6; // teleport distance when hit
export const WISP_BLINK_CD = 0.6; // min seconds between blinks
// ⚡ Sapper — anti-material
export const SAPPER_HP = 3;
export const SAPPER_R = 0.3;
export const SAPPER_CONTACT_RANGE = 0.75;
export const SAPPER_ATTACK_WINDUP = 0.35;
export const SAPPER_ATTACK_COOLDOWN = 1.5;
export const SAPPER_SPEED_FACTOR = 1.1;
export const SAPPER_FROM_LEVEL = 5;
// 💎 Crystalback — reflector (rooted, momentum-gated like a golem)
export const CRYSTAL_HP = 6;
export const CRYSTAL_R = 0.42;
export const CRYSTAL_CONTACT_RANGE = 0.82;
export const CRYSTAL_ATTACK_WINDUP = 0.5;
export const CRYSTAL_ATTACK_COOLDOWN = 1.5;
export const CRYSTAL_FROM_LEVEL = 4;
export const CRYSTAL_SHARDS = 7; // shards sprayed at YOU when rammed at speed
export const CRYSTAL_SHARD_DMG = 2;
// 🪞 Mimic — ambusher
export const MIMIC_HP = 4;
export const MIMIC_R = 0.34;
export const MIMIC_CONTACT_RANGE = 0.72;
export const MIMIC_ATTACK_WINDUP = 0.25;
export const MIMIC_ATTACK_COOLDOWN = 1.4;
export const MIMIC_SPEED_FACTOR = 1.3;
export const MIMIC_FROM_LEVEL = 3;
export const MIMIC_WAKE_RANGE = 1.7; // dormant until you step this close
