/**
 * Dungeon — every tuning number lives here.
 */

// ── Pixel pipeline ──────────────────────────────────────────────
/** Internal render resolution. FIXED — never scales with the window. */
export const RENDER_W = 320;
export const RENDER_H = 180;

/**
 * Pixels per world unit. RENDER_H / PPU = the ortho frustum height.
 * At 16, one tile (1 world unit) is exactly 16 screen pixels, and a 16px
 * sprite maps 1:1 onto screen pixels — which is the whole point.
 */
export const PPU = 16;

export const VIEW_W = RENDER_W / PPU; // 20 tiles across
export const VIEW_H = RENDER_H / PPU; // 11.25 tiles down

/**
 * Only upscale by whole numbers. Fractional scaling makes some pixels 4px wide
 * and others 5px, which reads as blurry/shimmery and kills the illusion. The
 * cost is letterboxing, which is the correct retro trade.
 */
export const INTEGER_SCALE = true;

// ── Camera ──────────────────────────────────────────────────────
/** Elevation above the horizon, radians. Diablo sits around 30-35°. */
export const CAMERA_TILT = (35 * Math.PI) / 180;
export const CAMERA_DIST = 24; // irrelevant to scale (ortho), just needs to clear geometry

// ── Sprites ─────────────────────────────────────────────────────
export const SPRITE_PX = 16; // native art size, px
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
export const WALL_H = 1.4;

// ── Player ──────────────────────────────────────────────────────
export const PLAYER_SPEED = 4.2; // tiles/sec
export const PLAYER_R = 0.3; // collision circle radius
export const PLAYER_MAX_HP = 6;
/** After taking a hit you can't be hit again for this long. */
export const PLAYER_IFRAMES = 0.9;

// The attack is a short arc in front of the facing direction. The active window
// is tied to the 3-frame 12fps attack clip so the hitbox agrees with the art:
// frame 0 is windup, frame 1 is the swing (active), frame 2 is recovery.
export const ATTACK_RANGE = 1.35;
export const ATTACK_ARC_COS = 0.5; // cos(60°) → a ±60° arc
export const ATTACK_COOLDOWN = 0.38;
export const ATTACK_DAMAGE = 1;
export const ATTACK_ACTIVE_START = 1 / FPS_ATTACK;
export const ATTACK_ACTIVE_END = 2 / FPS_ATTACK;
export const KNOCKBACK_ZOMBIE = 0.45; // how far a hit shoves a zombie
export const KNOCKBACK_PLAYER = 0.35;

// ── Zombies ─────────────────────────────────────────────────────
export const ZOMBIE_R = 0.3;
export const ZOMBIE_HP = 2;
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
  return {
    cellsW: Math.min(7 + l, 16),
    cellsH: Math.min(5 + Math.floor(l / 2), 11),
    zombies: Math.min(3 + 2 * l, 24),
    zombieSpeed: Math.min(1.25 + 0.08 * l, 2.2),
    torches: Math.min(6 + l, 14),
  };
}
