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

/**
 * Unlit sprites are more authentically 8-bit (flat, poster-like).
 * Lit sprites are more atmospheric and more Diablo.
 * Toggle live with [L] in the sandbox — we pick from screenshots.
 */
export const SPRITES_LIT_DEFAULT = false;

// ── Style toggles (all live-toggleable in the sandbox) ──────────
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

// ── Phase 0 sandbox room ────────────────────────────────────────
export const SANDBOX_W = 15;
export const SANDBOX_D = 11;
