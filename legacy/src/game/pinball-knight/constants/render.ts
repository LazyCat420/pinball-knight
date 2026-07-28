/**
 * Render pipeline, camera, sprites, lighting, atmosphere and animation timing.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
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

// ── Camera follow ───────────────────────────────────────────────
export const CAM_DEADZONE = 0.7; // player can wander this far before the camera moves
export const CAM_LERP = 6; // catch-up rate, 1/sec
