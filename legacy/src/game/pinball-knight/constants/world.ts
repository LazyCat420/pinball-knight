/**
 * World scale and the fixed-step game loop.
 *
 * Split out of the 2522-line constants.ts so parallel tracks stop colliding on
 * one file. Consumers still import from `../constants` — that barrel re-exports
 * every module here, so no call site changed.
 */
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
