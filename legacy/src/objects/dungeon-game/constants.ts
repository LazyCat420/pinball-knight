/**
 * Dungeon — every tuning number lives here.
 */

// ── Pixel pipeline ──────────────────────────────────────────────
/**
 * Internal render resolution. FIXED — never scales with the window.
 *
 * 640×360 is the "16-bit" step up from the original 320×180: same palette,
 * same quantize/dither pipeline, twice the detail per tile. Playtesting the
 * 320×180 build read as too chunky ("8-bit too granular" — 2026-07-14), and
 * doubling the grid keeps every downstream ratio identical: VIEW stays
 * 20×11.25 tiles, integer scale on a 1080p window is exactly 3×.
 */
export const RENDER_W = 640;
export const RENDER_H = 360;

/**
 * Pixels per world unit. RENDER_H / PPU = the ortho frustum height.
 * At 32, one tile (1 world unit) is exactly 32 screen pixels, and a 32px
 * sprite maps 1:1 onto screen pixels — which is the whole point.
 */
export const PPU = 32;

export const VIEW_W = RENDER_W / PPU; // 20 tiles across
export const VIEW_H = RENDER_H / PPU; // 11.25 tiles down

/**
 * Only upscale by whole numbers. Fractional scaling makes some pixels 4px wide
 * and others 5px, which reads as blurry/shimmery and kills the illusion. The
 * cost is letterboxing, which is the correct retro trade.
 */
export const INTEGER_SCALE = true;

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
export const CAMERA_DIST = 24; // irrelevant to scale (ortho), just needs to clear geometry

// ── Sprites ─────────────────────────────────────────────────────
export const SPRITE_PX = 32; // native art size, px
export const SPRITE_UNITS = SPRITE_PX / PPU; // 1.0 world units — 1:1 pixel mapping

// ── Style toggles (hidden debug keys Q/F/K in-game) ─────────────
export const QUANTIZE_DEFAULT = true; // snap to the 32-colour palette
export const DITHER_DEFAULT = true; // Bayer 4x4 ordered dither before the snap
export const SCANLINE_DEFAULT = false; // subtle CRT scanlines

// ── Animation ───────────────────────────────────────────────────
export const FPS_IDLE = 3;
export const FPS_WALK = 8;
export const FPS_ATTACK = 12;
export const FPS_DEATH = 6;

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
}

export function levelConfig(level: number): LevelConfig {
  const l = Math.max(1, level);
  // Cell counts are PRE-thickenWalls: the final tile grid is (2*cells+1)*2 —
  // level 1 is 66×46 tiles (≈16× the original build's 17×11), corridors 2
  // wide, wall bands 2 thick. Zombie count rides walkable area so density
  // stays roughly constant as depth grows.
  const cellsW = Math.min(15 + l, 26);
  const cellsH = Math.min(10 + Math.ceil(l / 2), 17);
  const floorTiles = cellsW * cellsH * 8; // ≈ walkable tiles after the 2× scale
  return {
    cellsW,
    cellsH,
    zombies: Math.min(Math.round(floorTiles / 34) + 2 * (l - 1), 48),
    zombieSpeed: Math.min(1.25 + 0.08 * l, 2.2),
    // Torches ride the maze area too — sparse torches left whole regions
    // pitch dark. Only TORCH_LIGHT_POOL of them are ever LIVE lights.
    torches: Math.min(Math.round(floorTiles / 55) + 8, 36),
  };
}
