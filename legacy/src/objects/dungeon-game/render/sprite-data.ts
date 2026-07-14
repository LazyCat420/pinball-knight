/**
 * THE PIXEL ART.
 *
 * Frames are 16x16 character grids. One char = one pixel. Edit these directly —
 * you don't need an art tool, and the diffs are readable.
 *
 * This is not a workaround for having no artist: it's the house style. Almost
 * every texture in this codebase is already a runtime CanvasTexture drawn with
 * 2D canvas calls (fishtank/aquarium/textures.ts, record-shelf.ts, window.ts).
 * We're doing the same thing, just from a pixel-matrix source.
 *
 * Rows are padded to 16 automatically, so trailing '.' are optional. A row
 * LONGER than 16 is a mistake and throws loudly at load.
 *
 * Only three directions are authored — W is E flipped horizontally at runtime,
 * which is a third of the art for no visible loss.
 */
import { SPRITE_PX } from "../constants";

/** char → palette index. '.' is transparent. See palette.ts for the ramps. */
export const CHARS: Record<string, number> = {
  ".": -1, // transparent
  o: 1, // outline
  a: 19, // steel dark
  A: 20, // steel mid
  B: 21, // steel light
  w: 22, // steel highlight (visor, blade)
  s: 23, // skin shadow
  S: 24, // skin
  h: 27, // leather dark
  l: 28, // leather mid
  y: 16, // torch gold (hilt)
  r: 12, // blood
  R: 13, // blood light
  g: 6, // rot shadow
  G: 8, // rot mid
  Y: 9, // rot light
  c: 31, // arcane light
};

export type Frame = string[];
export type Dir = "S" | "N" | "E";
export type ClipName = "idle" | "walk" | "attack" | "death";

/** Pad to SPRITE_PX and reject anything too wide/tall. */
function f(rows: string[]): Frame {
  if (rows.length !== SPRITE_PX) {
    throw new Error(`[dungeon] frame must be ${SPRITE_PX} rows, got ${rows.length}`);
  }
  return rows.map((r, i) => {
    if (r.length > SPRITE_PX) {
      throw new Error(`[dungeon] frame row ${i} is ${r.length} chars, max ${SPRITE_PX}: "${r}"`);
    }
    return r.padEnd(SPRITE_PX, ".");
  });
}

// ══════════════════════════════════════════════════════════════════
// PLAYER — an armoured hero with a sword
// ══════════════════════════════════════════════════════════════════

// ── Facing SOUTH (toward the camera) ──
//
// Proportions matter more than detail at 16px. An earlier pass had a 10px-wide
// body and a 4px band of near-white across the helmet, and it read as "a barrel
// wearing a white hat". The fixes: narrow the torso to 8px, put a DARK visor
// slit through the helmet so the head reads as a helmet and not a blank block,
// and give him a visible sword at rest so the silhouette says "hero".
const P_S_IDLE_0 = f([
  "................",
  "......oooo......",
  ".....oaAAao..B..",
  ".....oABBAo..B..",
  ".....oaooao..B..",
  ".....oSSSSo..B..",
  "......oSSo...y..",
  "...hloAAAAolyh..",
  "....oAABBAAo....",
  "....oABBBBAo....",
  "....oAABBAAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

// Breath: head and chest settle 1px. Subtle on purpose — an idle that moves too
// much reads as a walk cycle.
const P_S_IDLE_1 = f([
  "................",
  "................",
  "......oooo...B..",
  ".....oaAAao..B..",
  ".....oABBAo..B..",
  ".....oaooao..B..",
  ".....oSSSSo..y..",
  "......oSSo...y..",
  "...hloAAAAolh...",
  "....oAABBAAo....",
  "....oABBBBAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

// Walk: contact / pass / contact(opposite) / pass. At 16px the legs are only a
// few pixels, so the read comes from the spread, not from fine leg articulation.
const P_S_WALK_0 = f([
  "................",
  "......oooo......",
  ".....oaAAao..B..",
  ".....oABBAo..B..",
  ".....oaooao..B..",
  ".....oSSSSo..B..",
  "......oSSo...y..",
  "...hloAAAAolyh..",
  "....oAABBAAo....",
  "....oABBBBAo....",
  "....oAABBAAo....",
  "....ohhhhhho....",
  "...oll...llo....",
  "...oll...llo....",
  "..ohh.....hho...",
  "..oo.......oo...",
]);

const P_S_WALK_1 = P_S_IDLE_0;

const P_S_WALK_2 = f([
  "................",
  "......oooo......",
  ".....oaAAao..B..",
  ".....oABBAo..B..",
  ".....oaooao..B..",
  ".....oSSSSo..B..",
  "......oSSo...y..",
  "...hloAAAAolyh..",
  "....oAABBAAo....",
  "....oABBBBAo....",
  "....oAABBAAo....",
  "....ohhhhhho....",
  "....oll...llo...",
  "....oll...llo...",
  "...ohh.....hho..",
  "...oo.......oo..",
]);

const P_S_WALK_3 = P_S_IDLE_0;

// Attack: windup (blade high) → swing (blade across) → recover (blade low).
// Three frames is enough to read, and it lets the hitbox agree with the art:
// frame 1 is the only "active" frame.
const P_S_ATTACK_0 = f([
  "..........BBB...",
  "..........BBB...",
  "......oooo.By...",
  ".....oaAAaoy....",
  ".....oABBAo.....",
  ".....oaooao.....",
  ".....oSSSSo.....",
  "...hloAAAAolh...",
  "....oAABBAAo....",
  "....oABBBBAo....",
  "....oAABBAAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

const P_S_ATTACK_1 = f([
  "................",
  "......oooo......",
  ".....oaAAao.....",
  ".....oABBAo.....",
  ".....oaooao.....",
  ".....oSSSSo.....",
  "......oSSo......",
  "...hloAAAAolh...",
  "....oAABBAAo....",
  ".BBBBBBByAAAo...",
  "....oAABBAAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

const P_S_ATTACK_2 = f([
  "................",
  "......oooo......",
  ".....oaAAao.....",
  ".....oABBAo.....",
  ".....oaooao.....",
  ".....oSSSSo.....",
  "......oSSo......",
  "...hloAAAAolh...",
  "....oAABBAAo....",
  "....oABBBBAo....",
  "....oAABBAAoy...",
  "....ohhhhhhoyB..",
  "....oll..llo.BB.",
  "....oll..llo..B.",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

// ── Facing NORTH (away) — helmet back, no face, no visor ──
const P_N_IDLE_0 = f([
  "................",
  "......oooo......",
  ".....oaAAao..B..",
  ".....oAAAAo..B..",
  ".....oAAAAo..B..",
  ".....oaAAao..B..",
  "......oaao...y..",
  "...hloAAAAolyh..",
  "....oAAAAAAo....",
  "....oAaaaaAo....",
  "....oAAAAAAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

const P_N_IDLE_1 = f([
  "................",
  "................",
  "......oooo...B..",
  ".....oaAAao..B..",
  ".....oAAAAo..B..",
  ".....oAAAAo..B..",
  ".....oaAAao..y..",
  "......oaao...y..",
  "...hloAAAAolh...",
  "....oAAAAAAo....",
  "....oAaaaaAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

const P_N_WALK_0 = f([
  "................",
  "......oooo......",
  ".....oaAAao..B..",
  ".....oAAAAo..B..",
  ".....oAAAAo..B..",
  ".....oaAAao..B..",
  "......oaao...y..",
  "...hloAAAAolyh..",
  "....oAAAAAAo....",
  "....oAaaaaAo....",
  "....oAAAAAAo....",
  "....ohhhhhho....",
  "...oll...llo....",
  "...oll...llo....",
  "..ohh.....hho...",
  "..oo.......oo...",
]);

const P_N_WALK_1 = P_N_IDLE_0;

const P_N_WALK_2 = f([
  "................",
  "......oooo......",
  ".....oaAAao..B..",
  ".....oAAAAo..B..",
  ".....oAAAAo..B..",
  ".....oaAAao..B..",
  "......oaao...y..",
  "...hloAAAAolyh..",
  "....oAAAAAAo....",
  "....oAaaaaAo....",
  "....oAAAAAAo....",
  "....ohhhhhho....",
  "....oll...llo...",
  "....oll...llo...",
  "...ohh.....hho..",
  "...oo.......oo..",
]);

const P_N_WALK_3 = P_N_IDLE_0;

const P_N_ATTACK_0 = f([
  "..........BBB...",
  "..........BBB...",
  "......oooo.By...",
  ".....oaAAaoy....",
  ".....oAAAAo.....",
  ".....oAAAAo.....",
  ".....oaAAao.....",
  "...hloAAAAolh...",
  "....oAAAAAAo....",
  "....oAaaaaAo....",
  "....oAAAAAAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

const P_N_ATTACK_1 = f([
  "................",
  "......oooo......",
  ".....oaAAao.....",
  ".....oAAAAo.....",
  ".....oAAAAo.....",
  ".....oaAAao.....",
  "......oaao......",
  "...hloAAAAolh...",
  "....oAAAAAAo....",
  ".BBBBBBByAAAo...",
  "....oAAAAAAo....",
  "....ohhhhhho....",
  "....oll..llo....",
  "....oll..llo....",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

const P_N_ATTACK_2 = f([
  "................",
  "......oooo......",
  ".....oaAAao.....",
  ".....oAAAAo.....",
  ".....oAAAAo.....",
  ".....oaAAao.....",
  "......oaao......",
  "...hloAAAAolh...",
  "....oAAAAAAo....",
  "....oAaaaaAo....",
  "....oAAAAAAoy...",
  "....ohhhhhhoyB..",
  "....oll..llo.BB.",
  "....oll..llo..B.",
  "....ohh..hho....",
  ".....oo..oo.....",
]);

// ── Facing EAST (profile, right) — W is this, flipped ──
const P_E_IDLE_0 = f([
  "................",
  "......oooo......",
  ".....oaAAAo.....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "......oSSo......",
  "....hloAAAol....",
  "....oAABBAo.B...",
  "....oABBBAo.B...",
  "....oAABBAo.y...",
  ".....ohhhho.....",
  "....oll.llo.....",
  "....oll.llo.....",
  "...ohh...hho....",
  "...oo.....oo....",
]);

const P_E_IDLE_1 = f([
  "................",
  "................",
  "......oooo......",
  ".....oaAAAo.....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "......oSSo......",
  "....hloAAAol.B..",
  "....oAABBAo.B...",
  "....oABBBAo.y...",
  ".....ohhhho.....",
  "....oll.llo.....",
  "....oll.llo.....",
  "...ohh...hho....",
  "...oo.....oo....",
]);

const P_E_WALK_0 = f([
  "................",
  "......oooo......",
  ".....oaAAAo.....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "......oSSo......",
  "....hloAAAol....",
  "....oAABBAo.B...",
  "....oABBBAo.B...",
  "....oAABBAo.y...",
  ".....ohhhho.....",
  "...oll..llo.....",
  "..oll....llo....",
  "..ohh.....hho...",
  "..oo.......oo...",
]);

const P_E_WALK_1 = P_E_IDLE_0;

const P_E_WALK_2 = f([
  "................",
  "......oooo......",
  ".....oaAAAo.....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "......oSSo......",
  "....hloAAAol....",
  "....oAABBAo.B...",
  "....oABBBAo.B...",
  "....oAABBAo.y...",
  ".....ohhhho.....",
  "....oll.llo.....",
  "....oll..llo....",
  "...ohh....hho...",
  "...oo......oo...",
]);

const P_E_WALK_3 = P_E_IDLE_0;

const P_E_ATTACK_0 = f([
  "..........BBB...",
  "..........BBB...",
  "......oooo.By...",
  ".....oaAAaoy....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "....hloAAAol....",
  "....oAABBAo.....",
  "....oABBBAo.....",
  "....oAABBAo.....",
  ".....ohhhho.....",
  "....oll.llo.....",
  "....oll.llo.....",
  "...ohh...hho....",
  "...oo.....oo....",
]);

const P_E_ATTACK_1 = f([
  "................",
  "......oooo......",
  ".....oaAAAo.....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "......oSSo......",
  "....hloAAAol....",
  "....oAABBAo.....",
  "....oABBBAoyBBBB",
  "....oAABBAo.BBBB",
  ".....ohhhho.....",
  "....oll.llo.....",
  "....oll.llo.....",
  "...ohh...hho....",
  "...oo.....oo....",
]);

const P_E_ATTACK_2 = f([
  "................",
  "......oooo......",
  ".....oaAAAo.....",
  ".....oABBAo.....",
  ".....oaooSo.....",
  "......oSSSo.....",
  "......oSSo......",
  "....hloAAAol....",
  "....oAABBAo.....",
  "....oABBBAo.....",
  "....oAABBAoy....",
  ".....ohhhhoyB...",
  "....oll.llo.BB..",
  "....oll.llo..B..",
  "...ohh...hho....",
  "...oo.....oo....",
]);

// ══════════════════════════════════════════════════════════════════
// ZOMBIE — slow, rotten, arms out. Threatening in a group, trivial alone.
// ══════════════════════════════════════════════════════════════════

const Z_S_IDLE_0 = f([
  "................",
  ".....gggggg.....",
  "....gGYYYYGg....",
  "....gGrGGrGg....",
  "....gGGGGGGg....",
  "....gG.gg.Gg....",
  ".....gGGGGg.....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG..GGg....",
  "....gGG..GGg....",
  "....ghh..hhg....",
  ".....gg..gg.....",
]);

// Sway: the whole rotten mass lolls 1px. Zombies should never look composed.
const Z_S_IDLE_1 = f([
  "................",
  "......gggggg....",
  ".....gGYYYYGg...",
  ".....gGrGGrGg...",
  ".....gGGGGGGg...",
  ".....gG.gg.Gg...",
  "......gGGGGg....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG..GGg....",
  "....gGG..GGg....",
  "....ghh..hhg....",
  ".....gg..gg.....",
]);

const Z_S_WALK_0 = f([
  "................",
  ".....gggggg.....",
  "....gGYYYYGg....",
  "....gGrGGrGg....",
  "....gGGGGGGg....",
  "....gG.gg.Gg....",
  ".....gGGGGg.....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "...gGG...GGg....",
  "...gGG...GGg....",
  "..ghh.....hhg...",
  "..gg.......gg...",
]);

const Z_S_WALK_1 = Z_S_IDLE_1;

const Z_S_WALK_2 = f([
  "................",
  "......gggggg....",
  ".....gGYYYYGg...",
  ".....gGrGGrGg...",
  ".....gGGGGGGg...",
  ".....gG.gg.Gg...",
  "......gGGGGg....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG...GGg...",
  "....gGG...GGg...",
  "...ghh.....hhg..",
  "...gg.......gg..",
]);

const Z_S_WALK_3 = Z_S_IDLE_0;

// Death: buckle → fold → collapse → a heap and a stain. Plays once, then despawn.
const Z_S_DEATH_0 = f([
  "................",
  "................",
  ".....gggggg.....",
  "....gGrrrrGg....",
  "....gGRGGRGg....",
  "....gGGGGGGg....",
  "....gG.gg.Gg....",
  "...ggGGGGGGgg...",
  ".gGGGGGGGGGGGGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG..GGg....",
  "....gGG..GGg....",
  "....ghh..hhg....",
  ".....gg..gg.....",
  "................",
]);

const Z_S_DEATH_1 = f([
  "................",
  "................",
  "................",
  "................",
  "..g...gggggg....",
  "..gg.gGrrrrGg...",
  "...ggGRGGRGg....",
  "...ggGGGGGGg....",
  "..gGGGGGGGGGg...",
  "..gg.gGGGGg.gg..",
  "....gGGGGGGg....",
  "....gGG..GGg....",
  "....ghh..hhg....",
  ".....gg..gg.....",
  "................",
  "................",
]);

const Z_S_DEATH_2 = f([
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "..gg............",
  ".gGGgg..gggg....",
  ".gGrGGgGrrrGg...",
  "..gGGGGGRGGRGg..",
  "..gGGGGGGGGGGg..",
  "...ggGGGGGGgg...",
  "....gghhhhgg....",
  ".....gggggg.....",
  "................",
]);

const Z_S_DEATH_3 = f([
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "....r......r....",
  "...rRr..gg.rr...",
  "..rrGGggGGgGrr..",
  ".rRGGGGGGGGGGRr.",
  ".rrgGGGGGGGGgrr.",
  "..rr.gggggg.rr..",
  "...r..rrrr..r...",
]);

// North zombie: no face, just a rotten back and a slumped head.
const Z_N_IDLE_0 = f([
  "................",
  ".....gggggg.....",
  "....gGGGGGGg....",
  "....gGGGGGGg....",
  "....gGGGGGGg....",
  "....gGgggGGg....",
  ".....gGGGGg.....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG..GGg....",
  "....gGG..GGg....",
  "....ghh..hhg....",
  ".....gg..gg.....",
]);

const Z_N_IDLE_1 = f([
  "................",
  "......gggggg....",
  ".....gGGGGGGg...",
  ".....gGGGGGGg...",
  ".....gGGGGGGg...",
  ".....gGgggGGg...",
  "......gGGGGg....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG..GGg....",
  "....gGG..GGg....",
  "....ghh..hhg....",
  ".....gg..gg.....",
]);

const Z_N_WALK_0 = f([
  "................",
  ".....gggggg.....",
  "....gGGGGGGg....",
  "....gGGGGGGg....",
  "....gGGGGGGg....",
  "....gGgggGGg....",
  ".....gGGGGg.....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "...gGG...GGg....",
  "...gGG...GGg....",
  "..ghh.....hhg...",
  "..gg.......gg...",
]);

const Z_N_WALK_1 = Z_N_IDLE_1;

const Z_N_WALK_2 = f([
  "................",
  "......gggggg....",
  ".....gGGGGGGg...",
  ".....gGGGGGGg...",
  ".....gGGGGGGg...",
  ".....gGgggGGg...",
  "......gGGGGg....",
  "...ggGGGGGGgg...",
  "..gGGGGGGGGGGg..",
  ".gGg.gGGGGg.gGg.",
  ".gg..gGGGGg..gg.",
  ".....gGGGGg.....",
  "....gGG...GGg...",
  "....gGG...GGg...",
  "...ghh.....hhg..",
  "...gg.......gg..",
]);

const Z_N_WALK_3 = Z_N_IDLE_0;

// East zombie: profile, one arm reaching forward.
const Z_E_IDLE_0 = f([
  "................",
  ".....ggggg......",
  "....gGYYYYg.....",
  "....gGrGGGg.....",
  "....gGGGGGg.....",
  "....gG.ggGg.....",
  ".....gGGGg......",
  "...ggGGGGGgg....",
  "..gGGGGGGGGGGGg.",
  "..gGGGGGGGgg.gg.",
  "...gGGGGGg......",
  "....gGGGGg......",
  "....gGG.GGg.....",
  "....gGG.GGg.....",
  "...ghh...hhg....",
  "...gg.....gg....",
]);

const Z_E_IDLE_1 = f([
  "................",
  "......ggggg.....",
  ".....gGYYYYg....",
  ".....gGrGGGg....",
  ".....gGGGGGg....",
  ".....gG.ggGg....",
  "......gGGGg.....",
  "...ggGGGGGgg....",
  "..gGGGGGGGGGGGg.",
  "..gGGGGGGGgg.gg.",
  "...gGGGGGg......",
  "....gGGGGg......",
  "....gGG.GGg.....",
  "....gGG.GGg.....",
  "...ghh...hhg....",
  "...gg.....gg....",
]);

const Z_E_WALK_0 = f([
  "................",
  ".....ggggg......",
  "....gGYYYYg.....",
  "....gGrGGGg.....",
  "....gGGGGGg.....",
  "....gG.ggGg.....",
  ".....gGGGg......",
  "...ggGGGGGgg....",
  "..gGGGGGGGGGGGg.",
  "..gGGGGGGGgg.gg.",
  "...gGGGGGg......",
  "....gGGGGg......",
  "...gGG..GGg.....",
  "..gGG....GGg....",
  "..ghh.....hhg...",
  "..gg.......gg...",
]);

const Z_E_WALK_1 = Z_E_IDLE_1;

const Z_E_WALK_2 = f([
  "................",
  "......ggggg.....",
  ".....gGYYYYg....",
  ".....gGrGGGg....",
  ".....gGGGGGg....",
  ".....gG.ggGg....",
  "......gGGGg.....",
  "...ggGGGGGgg....",
  "..gGGGGGGGGGGGg.",
  "..gGGGGGGGgg.gg.",
  "...gGGGGGg......",
  "....gGGGGg......",
  "....gGG.GGg.....",
  "....gGG..GGg....",
  "...ghh....hhg...",
  "...gg......gg...",
]);

const Z_E_WALK_3 = Z_E_IDLE_0;

// ══════════════════════════════════════════════════════════════════
// Clip tables
// ══════════════════════════════════════════════════════════════════

export type ActorFrames = Record<Dir, Partial<Record<ClipName, Frame[]>>>;

export const PLAYER_FRAMES: ActorFrames = {
  S: {
    idle: [P_S_IDLE_0, P_S_IDLE_1],
    walk: [P_S_WALK_0, P_S_WALK_1, P_S_WALK_2, P_S_WALK_3],
    attack: [P_S_ATTACK_0, P_S_ATTACK_1, P_S_ATTACK_2],
  },
  N: {
    idle: [P_N_IDLE_0, P_N_IDLE_1],
    walk: [P_N_WALK_0, P_N_WALK_1, P_N_WALK_2, P_N_WALK_3],
    attack: [P_N_ATTACK_0, P_N_ATTACK_1, P_N_ATTACK_2],
  },
  E: {
    idle: [P_E_IDLE_0, P_E_IDLE_1],
    walk: [P_E_WALK_0, P_E_WALK_1, P_E_WALK_2, P_E_WALK_3],
    attack: [P_E_ATTACK_0, P_E_ATTACK_1, P_E_ATTACK_2],
  },
};

export const ZOMBIE_FRAMES: ActorFrames = {
  S: {
    idle: [Z_S_IDLE_0, Z_S_IDLE_1],
    walk: [Z_S_WALK_0, Z_S_WALK_1, Z_S_WALK_2, Z_S_WALK_3],
    death: [Z_S_DEATH_0, Z_S_DEATH_1, Z_S_DEATH_2, Z_S_DEATH_3],
  },
  N: {
    idle: [Z_N_IDLE_0, Z_N_IDLE_1],
    walk: [Z_N_WALK_0, Z_N_WALK_1, Z_N_WALK_2, Z_N_WALK_3],
    // Death is direction-agnostic — you fall the same way whichever way you faced.
    death: [Z_S_DEATH_0, Z_S_DEATH_1, Z_S_DEATH_2, Z_S_DEATH_3],
  },
  E: {
    idle: [Z_E_IDLE_0, Z_E_IDLE_1],
    walk: [Z_E_WALK_0, Z_E_WALK_1, Z_E_WALK_2, Z_E_WALK_3],
    death: [Z_S_DEATH_0, Z_S_DEATH_1, Z_S_DEATH_2, Z_S_DEATH_3],
  },
};
