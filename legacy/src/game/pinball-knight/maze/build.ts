/**
 * Maze grid → three.js geometry.
 *
 * WALL HEIGHT IS STRUCTURAL — the Diablo trick (see constants.ts): a wall
 * tile with walkable floor directly NORTH of it is the camera-side rim of
 * that corridor, so it renders knee-high; every other wall renders full
 * height and shows its big south face. The dungeon reads as a 3D side view
 * and yet no wall can ever cover an actor. Two InstancedMeshes (full + low)
 * = two draw calls for every wall in the maze, no per-frame matrix churn.
 *
 * Every wall cap carries a per-tile bordered texture, so tops read as a
 * clean square grid instead of runs of merged rectangles.
 *
 * Torches: every torch gets sconce + flame meshes, but only a small POOL of
 * PointLights exists (TORCH_LIGHT_POOL). core.ts parks the pool lights on the
 * torches nearest the player as they move — dozens of live point lights melt
 * a forward renderer, and far torches can't be seen lighting anything anyway.
 */
import * as THREE from "three";
import { createFireMaterial } from "../fx/elements/fire";
import type { ElementMaterial } from "../fx/elements/element";
import { PALETTE_HEX } from "../render/palette";
import {
  WALL_H,
  WALL_LOW,
  PPU,
  TORCH_LIGHT_POOL,
  PILASTER_EVERY,
  BANNER_EVERY,
  CLUTTER_EVERY,
  CAMERA_YAW,
  CAMERA_TILT,
} from "../constants";
import { type Grid, isWalkable, isLowWall, tileCenter, at, shapeAt, surfaceAt, T_CRACKED, idx } from "./generator";
import { wallSurface, floorSurface, WALL_STONE, FLOOR_STONE, FLOOR_ICE, FLOOR_SAND, FLOOR_STEEL } from "../engine/surfaces";
import { isRound, isShaped, isArc, shapeCorners, roundCenter, type TileShape, type ArcFeature } from "../engine/tile-shape";
import { buildArcKickers, type ArcKickerVisual } from "../render/arc-kickers";
import { buildArcLanes, type ArcLaneVisual } from "../render/arc-lanes";
import type { LevelPlan } from "./decorate";
import type { ArcCorner } from "../engine/collision";
import { clamp } from "../../../utils/math";

/** Deterministic hash-noise — no Math.random, so a level looks identical on rebuild. */
function noise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * TEXTURE CACHE — paint once, reuse for the rest of the run.
 *
 * Measured: the per-descent canvas work is ~75ms, and it is depth-independent
 * — sixteen textures rebuilt from scratch on every floor, several of them
 * 512x512 per-pixel double loops. That was pure waste, because every one of
 * these images is derived from PALETTE_HEX, a module constant. A Crypt floor
 * and a Bloodworks floor paint BYTE-IDENTICAL stone; only the scene lighting
 * differs between biomes (core.ts sets ambient/hemisphere colours, nothing
 * else). So the same picture was being repainted forever.
 *
 * Cached by a caller-supplied key. Entries deliberately OUTLIVE a floor: the
 * next floor wants the same images, and rebuilding them per descent is exactly
 * the cost being removed. That makes these immortal module state, so buildMaze
 * must NOT `track()` a cached texture for disposal — disposing one would blank
 * the texture for every later floor. See `cachedTexture` callers.
 *
 * REPEAT IS NOT PART OF THE IMAGE. Two floors of different sizes need the same
 * pixels tiled a different number of times, and repeat is a cheap property on
 * the texture object, not something painted into the canvas. Callers that need
 * a different repeat get a clone (which shares the underlying canvas/GPU
 * upload) rather than a repaint.
 */
const textureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Fetch or paint a texture under `key`. `make` runs only on a miss.
 *
 * The returned texture is SHARED — never dispose it, and never mutate anything
 * that changes its pixels. Setting `repeat`/`offset` on a shared texture would
 * affect every user, so use `cachedTiled` when the repeat varies.
 */
function cachedTexture(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  // The BIOME is part of every key. The masonry painters bake their stone
  // colours in (see BIOME_STONE), so a shared key would hand floor 2 the rock
  // floor 1 was built out of and the remap would look like it was never wired.
  // Textures that carry no stone colour (normal maps, the surface washes) pay a
  // rebuild per biome they are seen in — four at most, once each, against a
  // cache that already outlives every floor.
  const k = `${biomeIdx}|${key}`;
  const hit = textureCache.get(k);
  if (hit) return hit;
  const tex = make();
  textureCache.set(k, tex);
  return tex;
}

/**
 * A cached image at a caller-specific tiling. The canvas is painted once and
 * shared; only the lightweight wrapper differs per repeat.
 */
function cachedTiled(key: string, make: () => THREE.CanvasTexture, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const base = cachedTexture(key, make);
  if (base.repeat.x === repeatX && base.repeat.y === repeatY) return base;
  const clone = base.clone();
  clone.needsUpdate = true;
  clone.repeat.set(repeatX, repeatY);
  return clone;
}

/** Drop every cached texture. Only for a full teardown of the dungeon scene —
 *  NOT per floor, which is the entire point of the cache. */
export function clearTextureCache(): void {
  for (const t of textureCache.values()) t.dispose();
  textureCache.clear();
}

/**
 * AUTHORED tile-texture space: one world tile is this many texture pixels as
 * the painters below draw it.
 *
 * This used to be PPU itself, which quietly welded the tile ART to the camera's
 * zoom — every seam offset, chip position and shadow row in this file is a
 * number tuned against a 64px tile. Raising PPU to 96 for sprite fidelity would
 * have re-flowed all of them. Now the painters keep drawing at 64 and
 * `pixelTexture` rasterises at the camera's density instead, so the pattern is
 * identical and only the resolution goes up.
 */
const TILE_PX = 64;

/**
 * Round up to the next power of two.
 *
 * Every size fed to `pixelTexture` goes through this, because that function
 * mipmaps with RepeatWrapping and a non-power-of-two texture in that
 * combination is undefined in WebGL1 and renders BLACK. The sizes used to be
 * powers of two by luck — they were derived from PPU, and PPU was 64. Raising
 * PPU to 96 turned the floor into 768 and the walls into 96, which is exactly
 * the kind of change that looks fine in review and ships a black floor.
 *
 * Rounding UP rather than down on purpose: these are density figures for a
 * fidelity pass, so the error should land on the side of more texels.
 */
function potCeil(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

function pixelTexture(
  authoredPx: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  // Rasterise at the CAMERA's density, rounded up to a power of two, but let
  // the painter keep drawing in its authored space. Exactly the split sprite.ts
  // makes between ART_PX and SPRITE_PX, and for the same reason: the tile art's
  // coordinates (block seams every 22px, a 3px contact-shadow row) are tuned
  // numbers, and they must not move because the camera got closer.
  const size = potCeil((authoredPx * PPU) / TILE_PX);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.scale(size / authoredPx, size / authoredPx);
  paint(ctx);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  // Cel round: smooth filtering + mipmaps (potCeil guarantees powers of two).
  // Nearest-filtered texels were half of what still read as "pixel art", and
  // mipmapping kills the moiré the tilted camera used to make of the floor.
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  // Default flipY stays TRUE. "Walls upside down" was the PIXEL PASS flipping
  // the whole presented frame (see rtUv in engine/render/pixel-pass.ts);
  // flipY=false here only re-inverted this texture inside a flipped frame.
  return tex;
}

/**
 * Procedural NORMAL MAP baked from a height field, so the flat painted stone
 * detail becomes lit relief under the directional key light and the torches.
 *
 * `heightFn(x, y) → [0,1]` should MIRROR the diffuse paint (grooves where the
 * mortar seams are, domes where the blocks bulge). We Sobel-difference it into
 * a tangent-space normal. The texture is raw data (NOT sRGB) — colour-managing
 * a normal map would bend every surface normal toward the light and ruin it.
 */
function normalTexture(
  size: number,
  heightFn: (x: number, y: number) => number,
  repeatX: number,
  repeatY: number,
  strength: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const wrap = (v: number) => ((v % size) + size) % size;
  const h = (x: number, y: number) => heightFn(wrap(x), wrap(y));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const nz = 1.0;
      const len = Math.hypot(dx, dy, nz) || 1;
      const idx = (y * size + x) * 4;
      img.data[idx] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[idx + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // raw normal data — never sRGB
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  // MUST match pixelTexture's flipY (default true) — a normal map that
  // disagrees with its albedo lights every bevel from the wrong side.
  return tex;
}

// ── Height fields (mirror the diffuse painters above) ────────────
/** Flagstones: mortar seams are grooves, each stone domes gently to its centre. */
function floorHeight(x: number, y: number): number {
  const lx = x % TILE_PX;
  const ly = y % TILE_PX;
  const d = Math.min(lx, TILE_PX - lx, ly, TILE_PX - ly);
  if (d < 1.5) return 0.12; // mortar groove
  return 0.5 + (Math.min(d, 12) / 12) * 0.22; // dome toward the stone's middle
}
/** Wall face: mirrors the masonry layout — trim proud, mortar grooved, skirting recessed. */
function wallHeight(x: number, y: number): number {
  if (y >= TILE_PX - 3) return 0.05; // contact shadow row — deepest
  if (y >= 51) return 0.3; // skirting sits back
  if (y < 7) {
    // trim course: proud band with dentil grooves
    const inNotch = (x - 3) % 8 < 2 && y >= 2 && y < 5;
    return inNotch ? 0.35 : 0.75;
  }
  // block courses: mortar lines at 7 and 29 are grooves; block tops dome a little
  if (Math.abs(y - 7) < 1.5 || Math.abs(y - 29) < 1.5 || Math.abs(y - 51) < 1.5) return 0.15;
  const bx = (y < 29 ? x : x + 16) % 32; // vertical joints, offset per course
  if (bx < 1.5) return 0.15;
  return 0.55;
}
/** Wall cap: bordered square — the border is a groove, the interior sits proud,
 * and the carved inner panel line reads as a shallow chisel cut. */
function capHeight(x: number, y: number): number {
  if (x < 2 || x > TILE_PX - 2 || y < 2 || y > TILE_PX - 2) return 0.15;
  const onPanel =
    (Math.abs(x - 10) < 1.5 || Math.abs(x - (TILE_PX - 10)) < 1.5) && y >= 9 && y <= TILE_PX - 9;
  const onPanelH =
    (Math.abs(y - 10) < 1.5 || Math.abs(y - (TILE_PX - 10)) < 1.5) && x >= 9 && x <= TILE_PX - 9;
  if (onPanel || onPanelH) return 0.4;
  return 0.6;
}

/**
 * BIOME STONE REMAP — descending should change what the dungeon is MADE OF, not
 * how brightly it is lit.
 *
 * A depth's colour identity was one thing: `tintLights`, three light colours on
 * an otherwise identical grey-stone floor. That is a grade, and a grade cannot
 * change a hue very far before it just looks like a coloured lamp pointed at
 * grey stone — which is exactly what it looked like, because the masonry
 * textures are painted from FIXED palette indices and no light tint can move a
 * quantized palette entry onto a different one.
 *
 * So the masonry's own three stone tones are remapped per biome. Only entries
 * 2/3/4 (stone dark / mid / light) move; ink, torch, moss, timber and every prop
 * colour stay put, so the dungeon is recognisably the same place built out of a
 * different rock. `tintLights` still runs — the two now agree instead of one
 * doing all the work.
 *
 * Each row is picked to hold the ORIGINAL's value spread (roughly 0.18 / 0.30 /
 * 0.45 luma). A biome that is merely darker is not a different biome, it is a
 * readability problem, and this floor is already the darkest thing on screen.
 *
 * ── SECOND CONSTRAINT, ADDED AFTER INDEXED LIGHTING LANDED ────────────────────
 *
 * A row's DARK and MID must come from the SAME palette family. Since `51bbd77`
 * the pixel pass shades by walking an entry down its own family ramp, and these
 * three tones share one wall texture — mortar, face, highlight. Pick them from
 * different families and the wall's own tones diverge in HUE as it darkens,
 * because each walks a different ramp.
 *
 * The Bloodworks was the row that broke it: `[10, 27, 24]` was blood + leather +
 * skin, three materials pretending to be one rock, and its dark tone (0.113) sat
 * so close to ink that mortar read black before any shadow reached it. It is now
 * the blood ramp proper — which is also what the biome's own flavour line
 * promises, and what the brown-and-pink row never delivered.
 *
 * The LIGHT tone is exempt and the Arcane Deep uses it: arcane jumps 0.368 →
 * 0.712 with nothing at the baseline's 0.458, so its highlight borrows neutral
 * stone. That is a value problem, not a bloom one — 31's linear luma is 0.509,
 * comfortably under BLOOM_THRESHOLD. Highlights are sparse and shade least, so
 * the seam stays cosmetic.
 *
 * Gated by render/palette-install.test.ts.
 */
export const BIOME_STONE: ReadonlyArray<readonly [number, number, number]> = [
  [2, 3, 4], // 0 The Cold Crypt — the baseline: cold grey masonry
  [6, 7, 8], // 1 The Rotting Warren — mossed-through stone, near-identical values
  [11, 12, 13], // 2 The Bloodworks — the walls weep red: one blood ramp, 10 spare below
  [29, 30, 4], // 3 The Arcane Deep — cold blue rock, neutral stone highlights
];
let biomeIdx = 0;

/**
 * Set the stone family for the floor about to be built. Called from startLevel
 * alongside `tintLights`, and BEFORE `buildMaze` — the textures bake the colour
 * in, so changing it afterwards does nothing until the next descent.
 *
 * Every cached texture key carries the biome (see `cachedTexture`), or floor 2
 * would silently reuse floor 1's masonry and the whole system would look like
 * it had never been wired.
 */
export function setMazeBiome(index: number): void {
  const n = BIOME_STONE.length;
  biomeIdx = (((index | 0) % n) + n) % n;
}

const css = (i: number) => {
  const s = BIOME_STONE[biomeIdx];
  const j = i === 2 ? s[0] : i === 3 ? s[1] : i === 4 ? s[2] : i;
  return `#${PALETTE_HEX[j].toString(16).padStart(6, "0")}`;
};

/**
 * Flagstone floor. The texture spans FLOOR_BLOCK tiles of noise per repeat —
 * a one-tile texture repeats its speckle identically on every flagstone and
 * reads as wallpaper, not stone. Speckle stays SPARSE because the tilted
 * camera minifies the floor vertically and dense noise turns to moiré.
 *
 * 8 tiles per repeat, with per-tile VARIATION (mossy tiles, cracked tiles) —
 * the D2R environment lesson: repetition is what makes a dungeon floor read
 * as "basic", and variation is cheaper than detail.
 */
const FLOOR_BLOCK = 8;

function makeFloorTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const size = TILE_PX * FLOOR_BLOCK;
  return pixelTexture(
    size,
    (ctx) => {
      ctx.fillStyle = css(3);
      ctx.fillRect(0, 0, size, size);

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = noise(x, y, 1);
          if (n > 0.985) {
            ctx.fillStyle = css(4);
            ctx.fillRect(x, y, 1, 1);
          } else if (n < 0.015) {
            ctx.fillStyle = css(2);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // Per-tile character: patchwork values, moss, cracks, sunken stones and
      // the odd mosaic medallion. Hash-keyed so the pattern is stable.
      for (let tj = 0; tj < FLOOR_BLOCK; tj++) {
        for (let ti = 0; ti < FLOOR_BLOCK; ti++) {
          const h = noise(ti * 3.7, tj * 5.1, 42);
          const x0 = ti * TILE_PX;
          const y0 = tj * TILE_PX;

          // Patchwork: some flagstones are simply a different cut of stone.
          const patch = noise(ti * 7.3, tj * 2.9, 61);
          if (patch < 0.14) {
            ctx.fillStyle = css(2);
            ctx.fillRect(x0 + 1, y0 + 1, TILE_PX - 2, TILE_PX - 2);
          } else if (patch > 0.9) {
            ctx.fillStyle = css(4);
            ctx.fillRect(x0 + 1, y0 + 1, TILE_PX - 2, TILE_PX - 2);
            for (let k = 0; k < 40; k++) {
              const sx = x0 + 1 + Math.floor(noise(ti + k, tj, 63) * (TILE_PX - 2));
              const sy = y0 + 1 + Math.floor(noise(ti, tj + k, 65) * (TILE_PX - 2));
              ctx.fillStyle = css(3);
              ctx.fillRect(sx, sy, 1, 1);
            }
          }

          // Mosaic medallion — an inlaid arcane diamond, rare enough to be a
          // landmark ("I've passed this one before").
          if (h > 0.4 && h < 0.455) {
            const cx = x0 + TILE_PX / 2;
            const cy = y0 + TILE_PX / 2;
            const ring = (r: number, col: string): void => {
              ctx.strokeStyle = col;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(cx, cy - r);
              ctx.lineTo(cx + r, cy);
              ctx.lineTo(cx, cy + r);
              ctx.lineTo(cx - r, cy);
              ctx.closePath();
              ctx.stroke();
            };
            ring(24, css(29));
            ring(17, css(30));
            ring(10, css(19));
            ctx.fillStyle = css(30);
            ctx.fillRect(cx - 2, cy - 2, 4, 4);
            continue; // a medallion tile doesn't also grow moss/cracks
          }

          if (h > 0.82) {
            // moss creep — soft green mottling over the stone
            for (let y = 2; y < TILE_PX - 2; y++) {
              for (let x = 2; x < TILE_PX - 2; x++) {
                const m = noise(x0 + x, y0 + y, 77);
                if (m > 0.55) {
                  ctx.fillStyle = css(m > 0.8 ? 7 : 6);
                  ctx.fillRect(x0 + x, y0 + y, 1, 1);
                }
              }
            }
          } else if (h < 0.1) {
            // cracked flagstone — a dark jagged diagonal
            let cx = 3 + Math.floor(noise(ti, tj, 9) * 8);
            for (let y = 4; y < TILE_PX - 4; y++) {
              ctx.fillStyle = css(1);
              ctx.fillRect(x0 + cx, y0 + y, 1, 1);
              cx += noise(cx, y0 + y, 11) > 0.5 ? 1 : noise(cx, y0 + y, 12) > 0.5 ? -1 : 0;
              cx = clamp(cx, 2, TILE_PX - 3);
            }
          } else if (h > 0.76) {
            // sunken tile — a shade darker, catches the eye like wear
            ctx.fillStyle = "rgba(11, 13, 18, 0.28)";
            ctx.fillRect(x0 + 1, y0 + 1, TILE_PX - 2, TILE_PX - 2);
          }
        }
      }

      // Mortar seams at one-tile pitch, with a light chip under each horizontal
      // seam so the flagstones read as bevelled rather than printed.
      for (let i = 0; i < FLOOR_BLOCK; i++) {
        const p = i * TILE_PX;
        ctx.fillStyle = css(1);
        ctx.fillRect(0, p, size, 1);
        ctx.fillRect(p, 0, 1, size);
        ctx.fillStyle = css(2);
        ctx.fillRect(0, p + 1, size, 1);
      }
    },
    repeatX,
    repeatY,
  );
}

/**
 * Wall face — REAL masonry (the Castlevania pass). Vertical layout at 64px:
 *
 *     0.. 7  carved trim course (light band, dentil notches)
 *     7..51  two block courses, 32px blocks, offset like real coursing;
 *            every block gets its own value (hash), a bevel highlight on top
 *            and a shadow on its base, plus sparse chips/cracks
 *    51..61  skirting course (dark base band with a top highlight line)
 *    61..64  contact shadow into the floor
 *
 * `mossy` grows damp rot up from the base. `low` paints the knee-wall variant
 * (rim walls are 0.35 high — a full design would squash to stripes).
 */
function makeWallTexture(mossy = false, low = false, cracked = false): THREE.CanvasTexture {
  /**
   * The SECRET-WALL tell: a jagged dark fissure forking down the masonry with
   * gold glints along its lips — bright enough to catch a sweeping eye, quiet
   * enough that finding one still feels earned. Painted OVER the finished
   * face; deterministic (hash noise) like everything else here.
   */
  const paintCrack = (ctx: CanvasRenderingContext2D): void => {
    let cx = TILE_PX / 2 - 3;
    for (let y = 2; y < TILE_PX - 2; y++) {
      ctx.fillStyle = css(0);
      ctx.fillRect(cx, y, 2, 1);
      // a thin side-branch halfway down
      if (y === Math.floor(TILE_PX / 2)) {
        let bx = cx;
        for (let k = 0; k < 12; k++) {
          bx += 1;
          ctx.fillRect(bx, y - Math.floor(k / 2), 1, 1);
        }
      }
      cx += noise(cx, y, 57) > 0.5 ? 1 : noise(cx, y, 58) > 0.5 ? -1 : 0;
      cx = clamp(cx, 6, TILE_PX - 8);
      // gold glints scattered along the crack lips
      if (noise(cx, y, 59) > 0.82) {
        ctx.fillStyle = css(16);
        ctx.fillRect(cx + (noise(y, cx, 60) > 0.5 ? 2 : -1), y, 1, 1);
      }
    }
  };

  return pixelTexture(
    TILE_PX,
    (ctx) => {
      ctx.fillStyle = css(2);
      ctx.fillRect(0, 0, TILE_PX, TILE_PX);

      if (low) {
        // Knee wall: one course of small blocks + top highlight + base shadow.
        ctx.fillStyle = css(1);
        for (let bx = 0; bx <= TILE_PX; bx += 22) ctx.fillRect(bx, 0, 1, TILE_PX);
        ctx.fillRect(0, 28, TILE_PX, 1);
        ctx.fillStyle = css(4);
        ctx.fillRect(0, 0, TILE_PX, 2); // top catch-light
        ctx.fillStyle = css(0);
        ctx.fillRect(0, TILE_PX - 4, TILE_PX, 4);
        if (cracked) paintCrack(ctx);
        return;
      }

      const TRIM_H = 7;
      const SKIRT_Y = 51;
      const BLOCK_W = 32;
      const courseTop = [TRIM_H, TRIM_H + 22];

      // ── block courses, hash-valued per block ──
      courseTop.forEach((cy, course) => {
        const ch = course === 0 ? 22 : SKIRT_Y - cy;
        const off = course % 2 === 0 ? 0 : BLOCK_W / 2;
        for (let bx = -BLOCK_W; bx < TILE_PX + BLOCK_W; bx += BLOCK_W) {
          const x0 = bx + off;
          const h = noise(x0, cy, mossy ? 31 : 17);
          // block body — mostly dark stone, the odd lighter replacement block
          ctx.fillStyle = h > 0.8 ? css(3) : css(2);
          ctx.fillRect(x0 + 1, cy + 1, BLOCK_W - 2, ch - 2);
          // bevel: catch-light on top, settled shadow on the base
          ctx.fillStyle = h > 0.8 ? css(4) : css(3);
          ctx.fillRect(x0 + 1, cy + 1, BLOCK_W - 2, 1);
          ctx.fillStyle = css(1);
          ctx.fillRect(x0 + 1, cy + ch - 1, BLOCK_W - 2, 1);
          // chips + a hairline crack on some blocks
          if (h < 0.22) {
            let cx = x0 + 6 + Math.floor(noise(x0, cy, 5) * (BLOCK_W - 14));
            for (let y = cy + 3; y < cy + ch - 2; y++) {
              ctx.fillStyle = css(1);
              ctx.fillRect(cx, y, 1, 1);
              cx += noise(cx, y, 3) > 0.5 ? 1 : noise(cx, y, 4) > 0.5 ? -1 : 0;
            }
          }
          for (let k = 0; k < 4; k++) {
            const sx = x0 + 3 + Math.floor(noise(x0 + k, cy, 9) * (BLOCK_W - 6));
            const sy = cy + 3 + Math.floor(noise(x0, cy + k, 13) * (ch - 6));
            ctx.fillStyle = css(noise(sx, sy, 15) > 0.5 ? 3 : 1);
            ctx.fillRect(sx, sy, 1, 1);
          }
        }
        // mortar line between courses
        ctx.fillStyle = css(1);
        ctx.fillRect(0, cy, TILE_PX, 1);
      });

      // ── carved trim course along the top ──
      ctx.fillStyle = css(3);
      ctx.fillRect(0, 0, TILE_PX, TRIM_H);
      ctx.fillStyle = css(4);
      ctx.fillRect(0, 0, TILE_PX, 1); // top catch-light
      ctx.fillStyle = css(1);
      ctx.fillRect(0, TRIM_H - 1, TILE_PX, 1);
      for (let dx = 3; dx < TILE_PX; dx += 8) {
        ctx.fillStyle = css(1);
        ctx.fillRect(dx, 2, 2, TRIM_H - 4); // dentil notches
      }

      // ── skirting base course ──
      ctx.fillStyle = css(1);
      ctx.fillRect(0, SKIRT_Y, TILE_PX, TILE_PX - SKIRT_Y);
      ctx.fillStyle = css(3);
      ctx.fillRect(0, SKIRT_Y, TILE_PX, 1); // ledge highlight
      ctx.fillStyle = css(2);
      for (let bx = 8; bx < TILE_PX; bx += 16) ctx.fillRect(bx, SKIRT_Y + 3, 1, 6); // joints

      if (mossy) {
        // Damp rot climbing from the floor — denser at the bottom.
        for (let y = TILE_PX / 2; y < TILE_PX; y++) {
          const density = (y - TILE_PX / 2) / (TILE_PX / 2);
          for (let x = 0; x < TILE_PX; x++) {
            if (noise(x, y, 21) < density * 0.5) {
              ctx.fillStyle = css(noise(x, y, 23) > 0.6 ? 7 : 6);
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      // Contact shadow along the bottom of the face — grounds the wall.
      ctx.fillStyle = css(0);
      ctx.fillRect(0, TILE_PX - 3, TILE_PX, 3);

      if (cracked) paintCrack(ctx);
    },
    1,
    1,
  );
}

/**
 * Wall cap: ONE grid cell per tile — solid border, DARK stone fill (clearly
 * darker than the floor, so corridors read as bright paths between dark wall
 * bands), a subtle top-edge bevel. This is what stops rows of walls fusing
 * into anonymous rectangle slabs: every wall tile reads as a square on the
 * grid.
 */
function makeCapTexture(): THREE.CanvasTexture {
  return pixelTexture(
    TILE_PX,
    (ctx) => {
      ctx.fillStyle = css(2);
      ctx.fillRect(0, 0, TILE_PX, TILE_PX);

      // sparse chips
      for (let y = 2; y < TILE_PX - 2; y++) {
        for (let x = 2; x < TILE_PX - 2; x++) {
          if (noise(x, y, 13) > 0.96) {
            ctx.fillStyle = css(3);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // tile border — the grid line
      ctx.fillStyle = css(1);
      ctx.fillRect(0, 0, TILE_PX, 1);
      ctx.fillRect(0, TILE_PX - 1, TILE_PX, 1);
      ctx.fillRect(0, 0, 1, TILE_PX);
      ctx.fillRect(TILE_PX - 1, 0, 1, TILE_PX);
      // top bevel just inside the border (north edge catches the "light")
      ctx.fillStyle = css(4);
      ctx.fillRect(1, 1, TILE_PX - 2, 1);

      // carved inner panel — an inset square with nicked corners, so caps
      // read as dressed stone instead of blank slabs
      ctx.strokeStyle = css(1);
      ctx.lineWidth = 1;
      ctx.strokeRect(9.5, 9.5, TILE_PX - 19, TILE_PX - 19);
      ctx.strokeStyle = css(3);
      ctx.strokeRect(10.5, 10.5, TILE_PX - 21, TILE_PX - 21);
      ctx.fillStyle = css(1);
      for (const [cx, cy] of [[9, 9], [TILE_PX - 11, 9], [9, TILE_PX - 11], [TILE_PX - 11, TILE_PX - 11]] as const) {
        ctx.fillRect(cx, cy, 2, 2);
      }
    },
    1,
    1,
  );
}

/**
 * Swallowtail wall banner, two liveries: blood (steel diamond emblem) and
 * arcane (gold emblem). The swallowtail notch is cut via transparency.
 */
function makeBannerTexture(arcane: boolean): THREE.CanvasTexture {
  const W = 32;
  const H = 56;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const cloth = arcane ? css(29) : css(11);
  const clothLit = arcane ? css(30) : css(12);
  const emblem = arcane ? css(16) : css(21);

  ctx.fillStyle = cloth;
  ctx.fillRect(2, 4, W - 4, H - 4);
  // hanging pole
  ctx.fillStyle = css(27);
  ctx.fillRect(0, 0, W, 4);
  ctx.fillStyle = css(28);
  ctx.fillRect(0, 0, W, 1);
  // gold trim
  ctx.fillStyle = css(16);
  ctx.fillRect(2, 4, W - 4, 2);
  ctx.fillRect(2, 4, 2, H - 4);
  ctx.fillRect(W - 4, 4, 2, H - 4);
  // cloth sheen down one side + fold shadows
  ctx.fillStyle = clothLit;
  ctx.fillRect(5, 8, 3, H - 16);
  ctx.fillStyle = css(arcane ? 29 : 10);
  ctx.fillRect(12, 8, 2, H - 14);
  ctx.fillRect(22, 8, 2, H - 12);
  // emblem diamond
  ctx.fillStyle = emblem;
  const cx = W / 2;
  const cy = 24;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 7);
  ctx.lineTo(cx + 6, cy);
  ctx.lineTo(cx, cy + 7);
  ctx.lineTo(cx - 6, cy);
  ctx.closePath();
  ctx.fill();
  // swallowtail: cut a transparent notch from the bottom edge
  ctx.clearRect(0, 0, 2, H);
  ctx.clearRect(W - 2, 0, 2, H);
  const g = ctx.getImageData(0, 0, W, H);
  for (let y = H - 12; y < H; y++) {
    const half = Math.floor(((y - (H - 12)) / 12) * (W / 2 - 3));
    for (let x = cx - half - 1; x <= cx + half; x++) {
      const p = (y * W + clamp(x, 0, W - 1)) * 4;
      g.data[p + 3] = 0;
    }
  }
  ctx.putImageData(g, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Default flipY stays TRUE — the "pole-down banner" was the pixel pass
  // flipping the whole frame (rtUv in engine/render/pixel-pass.ts).
  return tex;
}

/** Nailed plank crate face. */
function makeCrateTexture(): THREE.CanvasTexture {
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css(27);
  ctx.fillRect(0, 0, S, S);
  // planks
  ctx.fillStyle = css(26);
  for (let y = 8; y < S; y += 8) ctx.fillRect(1, y, S - 2, 1);
  ctx.fillStyle = css(28);
  for (let y = 1; y < S; y += 8) ctx.fillRect(1, y, S - 2, 1);
  // frame + nails
  ctx.strokeStyle = css(26);
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, S - 2, S - 2);
  ctx.fillStyle = css(19);
  for (const [nx, ny] of [[4, 4], [S - 6, 4], [4, S - 6], [S - 6, S - 6]] as const) ctx.fillRect(nx, ny, 2, 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Barrel staves with two steel hoops. */
function makeBarrelTexture(): THREE.CanvasTexture {
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css(27);
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = css(26);
  for (let x = 5; x < S; x += 6) ctx.fillRect(x, 0, 1, S); // stave joints
  ctx.fillStyle = css(19);
  ctx.fillRect(0, 6, S, 3); // hoops
  ctx.fillRect(0, S - 9, S, 3);
  ctx.fillStyle = css(20);
  ctx.fillRect(0, 6, S, 1);
  ctx.fillRect(0, S - 9, S, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * SURFACE WASH TEXTURES — a painted patch has to look like a MATERIAL.
 *
 * `Grid.surfaces` decides physics per tile (engine/surfaces.ts) and the maze
 * track's painter now covers a median of ~1900 tiles a floor with it. The
 * renderer's answer was one flat colour quad per tile at 0.42 opacity, which on
 * screen is a big saturated rectangle: the ice patch reads as a spilled bucket
 * of blue, not as ice, and the flowstone patch reads as green paint — green
 * paint that a rot-green horde then stands on invisibly.
 *
 * Physics contrast is this game's light and dark, so a surface has to be
 * recognisable from across the room AND it has to say why it behaves the way it
 * does. Each material gets a small tiling texture whose grain explains its
 * numbers:
 *
 *   ICE       — long crystalline fractures, all leaning the same way. Nothing
 *               holds a line on it (steerMult 0.25) and neither do they.
 *   SAND      — dense loose grain and wind ripples. frictionMult 2.4, visibly.
 *   STEEL     — riveted plate and panel seams. The one man-made floor.
 *   FLOWSTONE — knobbly mineral pebbling. The grip IS the texture.
 *
 * Alpha-painted so the flagstone still reads THROUGH the patch, which is the
 * one thing the flat wash got right. Four textures, cached for the session.
 */
const SURFACE_WASH_PX = 64;

function makeSurfaceWashTexture(floorId: number): THREE.CanvasTexture {
  return cachedTexture(`wash-${floorId}`, () =>
    pixelTexture(
      SURFACE_WASH_PX,
      (ctx) => {
        const S = SURFACE_WASH_PX;
        ctx.clearRect(0, 0, S, S);
        // Seeded per material so two materials never share a speckle pattern.
        const seed = 17 + floorId * 131;
        if (floorId === FLOOR_ICE) {
          ctx.fillStyle = "rgba(111, 208, 232, 0.30)"; // arcane light 31
          ctx.fillRect(0, 0, S, S);
          ctx.strokeStyle = "rgba(238, 241, 245, 0.55)"; // steel highlight 22
          ctx.lineWidth = 1;
          for (let i = 0; i < 7; i++) {
            const y = noise(i, 3, seed) * S;
            ctx.beginPath();
            ctx.moveTo(-4, y);
            ctx.lineTo(S + 4, y - S * 0.34);
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(200, 204, 212, 0.30)"; // steel light 21
          for (let i = 0; i < 26; i++) ctx.fillRect(noise(i, 11, seed) * S, noise(i, 12, seed) * S, 2, 1);
        } else if (floorId === FLOOR_SAND) {
          ctx.fillStyle = "rgba(122, 59, 18, 0.34)"; // ember 14
          ctx.fillRect(0, 0, S, S);
          ctx.strokeStyle = "rgba(217, 123, 41, 0.28)"; // flame dark 15
          ctx.lineWidth = 2;
          for (let i = 0; i < 6; i++) {
            const y = (i / 6) * S + noise(i, 5, seed) * 4;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.quadraticCurveTo(S / 2, y + 5, S, y);
            ctx.stroke();
          }
          for (let i = 0; i < 160; i++) {
            ctx.fillStyle = noise(i, 7, seed) > 0.5 ? "rgba(240, 166, 60, 0.34)" : "rgba(74, 50, 34, 0.34)";
            ctx.fillRect(noise(i, 8, seed) * S, noise(i, 9, seed) * S, 1, 1);
          }
        } else if (floorId === FLOOR_STEEL) {
          ctx.fillStyle = "rgba(138, 148, 166, 0.34)"; // steel mid 20
          ctx.fillRect(0, 0, S, S);
          ctx.strokeStyle = "rgba(84, 78, 99, 0.55)"; // steel dark 19
          ctx.lineWidth = 2;
          for (const p of [0, S / 2]) {
            ctx.beginPath();
            ctx.moveTo(p, 0);
            ctx.lineTo(p, S);
            ctx.moveTo(0, p);
            ctx.lineTo(S, p);
            ctx.stroke();
          }
          ctx.fillStyle = "rgba(238, 241, 245, 0.50)"; // steel highlight 22
          for (let gx = 0; gx < 2; gx++) {
            for (let gy = 0; gy < 2; gy++) {
              const cx = gx * (S / 2) + S / 4;
              const cy = gy * (S / 2) + S / 4;
              for (const o of [[-9, -9], [9, -9], [-9, 9], [9, 9]] as Array<[number, number]>) {
                ctx.fillRect(cx + o[0], cy + o[1], 2, 2);
              }
            }
          }
        } else {
          // FLOOR_GRIP — flowstone: knobbly mineral deposit, lit up-left to
          // match the scene's key so the bumps read as bumps and not as spots.
          ctx.fillStyle = "rgba(61, 92, 58, 0.32)"; // rot dark 7
          ctx.fillRect(0, 0, S, S);
          for (let i = 0; i < 40; i++) {
            const x = noise(i, 21, seed) * S;
            const y = noise(i, 22, seed) * S;
            const r = 1.5 + noise(i, 23, seed) * 3;
            ctx.beginPath();
            ctx.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(95, 138, 79, 0.40)"; // rot mid 8
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(x - r * 0.3, y - r * 0.32, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(143, 196, 107, 0.42)"; // rot light 9
            ctx.fill();
          }
        }
      },
      1,
      1,
    ),
  );
}

export interface TorchAnchor {
  x: number;
  z: number;
}

export interface MazeHandle {
  group: THREE.Group;
  /** Where every torch's flame is (light pool targets). */
  torchAnchors: TorchAnchor[];
  /** The shared PointLight pool — core parks these on the nearest anchors. */
  lightPool: THREE.PointLight[];
  /**
   * The torch flame's SHADER CLOCK — one handle for every torch on the floor.
   *
   * Was `Array<{tex, phase}>`: one cloned texture per torch, whose `offset.x` the
   * frame loop stepped through a 4-frame strip. The shader self-animates and
   * decorrelates by world position, so all the loop has to do is advance one
   * `uTime`. Kept on the maze handle rather than registered with `fx/floor/decals`
   * because the maze already owns disposing it, and two owners is how a leak
   * starts.
   */
  flame: ElementMaterial;
  /** The stairs beacon — core pulses its opacity + feeds it rising motes so
   *  the way down reads as living energy, not a static prop. */
  stairsBeam: { mat: THREE.MeshBasicMaterial; mesh: THREE.Mesh; x: number; z: number };
  /**
   * The still-intact secret bands: (i,j) = the 2×2 band's top-left tile, (x,z)
   * its world centre, mesh the removable Group. secrets.ts splices entries as
   * they're smashed; geometry/materials stay tracked for level disposal.
   */
  secrets: Array<{ i: number; j: number; x: number; z: number; mesh: THREE.Object3D }>;
  /** Tile "i,j" → the wall InstancedMesh + instance index drawing it, so a
   * high-speed smash can hide one wall at runtime (secrets.ts smashWallAt). */
  wallAt: Map<string, { mesh: THREE.InstancedMesh; index: number }>;
  /** The BOOSTER rubber on the curved sweeps — core ticks their cooldown/flash
   *  each frame (render/arc-kickers.updateArcKickers). Empty on floors whose
   *  sweeps drew no bands. */
  arcKickers: ArcKickerVisual[];
  /** The BOOSTER LANES on the curved sweeps — core ticks their cooldown/flash
   *  each frame (render/arc-lanes.updateArcLanes). Empty on floors whose sweeps
   *  drew no lanes. */
  arcLanes: ArcLaneVisual[];
  dispose(): void;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}
type UV = [number, number];

/**
 * Right-triangular-prism geometry for a SLANT tile: the solid triangle
 * (tile-shape.ts, tile-local [0,1]²) extruded to `height`, re-centred on the
 * tile in xz (origin) with its base at y=0. Non-indexed with explicit per-face
 * normals (crisp faceted shading — the hypotenuse's normal matches the collider
 * normal) and two geometry groups: side faces → material 0 (wall face),
 * top/bottom caps → material 1 (cap). Mirrors the box wall's [face…, cap] setup.
 */
function slantPrismGeometry(shape: TileShape, height: number): THREE.BufferGeometry {
  const P = shapeCorners(shape)!.map((c) => ({ x: c.x - 0.5, z: c.z - 0.5 })); // tile-centred
  const bot: V3[] = P.map((p) => ({ x: p.x, y: 0, z: p.z }));
  const top: V3[] = P.map((p) => ({ x: p.x, y: height, z: p.z }));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const tri = (a: V3, b: V3, c: V3, n: V3, ua: UV, ub: UV, uc: UV): void => {
    // Wind the triangle CCW with respect to the intended outward normal `n`.
    let B = b;
    let C = c;
    let UB = ub;
    let UC = uc;
    const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
    const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
    const cxn = e1y * e2z - e1z * e2y;
    const cyn = e1z * e2x - e1x * e2z;
    const czn = e1x * e2y - e1y * e2x;
    if (cxn * n.x + cyn * n.y + czn * n.z < 0) {
      B = c;
      C = b;
      UB = uc;
      UC = ub;
    }
    pos.push(a.x, a.y, a.z, B.x, B.y, B.z, C.x, C.y, C.z);
    nor.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    uv.push(ua[0], ua[1], UB[0], UB[1], UC[0], UC[1]);
  };
  // Caps first (group → cap material).
  const capUV = (p: V3): UV => [p.x + 0.5, p.z + 0.5];
  tri(top[0], top[1], top[2], { x: 0, y: 1, z: 0 }, capUV(top[0]), capUV(top[1]), capUV(top[2]));
  tri(bot[0], bot[1], bot[2], { x: 0, y: -1, z: 0 }, capUV(bot[0]), capUV(bot[1]), capUV(bot[2]));
  const capVerts = pos.length / 3;
  // Side faces (group → wall-face material): one quad per triangle edge.
  for (let e = 0; e < 3; e++) {
    const a = e;
    const b = (e + 1) % 3;
    const third = P[(e + 2) % 3];
    let nx = P[b].z - P[a].z; // horizontal perpendicular of the edge
    let nz = -(P[b].x - P[a].x);
    const mx = third.x - (P[a].x + P[b].x) / 2;
    const mz = third.z - (P[a].z + P[b].z) / 2;
    if (nx * mx + nz * mz > 0) {
      nx = -nx;
      nz = -nz;
    } // point away from the interior
    const len = Math.hypot(nx, nz) || 1;
    const n: V3 = { x: nx / len, y: 0, z: nz / len };
    const elen = Math.hypot(P[b].x - P[a].x, P[b].z - P[a].z);
    tri(bot[a], bot[b], top[b], n, [0, 0], [elen, 0], [elen, 1]);
    tri(bot[a], top[b], top[a], n, [0, 0], [elen, 1], [0, 1]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.addGroup(0, capVerts, 1); // caps → material index 1
  geo.addGroup(capVerts, pos.length / 3 - capVerts, 0); // sides → material index 0
  return geo;
}

/**
 * Curved-wall shell for a ROUND tile: a quarter-cylinder face (radius 1, the
 * quarter that faces the cut/open corner) sampled in the SAME frame the collider
 * uses (centre = tile-shape.roundCenter, radius 1) so the visible curve sits
 * exactly on the collider arc. Capless shell (DoubleSide material) like the old
 * curve court — but now bound to a real per-tile collider, so no more mismatch.
 */
function roundShellGeometry(shape: TileShape, height: number, seg = 12): THREE.BufferGeometry {
  const cc = roundCenter(shape)!; // tile-local [0,1]
  const cx = cc.x - 0.5; // tile-centred
  const cz = cc.z - 0.5;
  // The two arc endpoints are the corners adjacent to the cut (share one axis
  // with the centre); the 90° arc sweeps between them around the centre.
  const e0 = { x: 1 - cc.x, z: cc.z };
  const e1 = { x: cc.x, z: 1 - cc.z };
  const start = Math.atan2(e0.z - cc.z, e0.x - cc.x);
  let da = Math.atan2(e1.z - cc.z, e1.x - cc.x) - start;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const ring: Array<{ x: number; z: number }> = [];
  for (let s = 0; s <= seg; s++) {
    const t = start + da * (s / seg);
    ring.push({ x: cx + Math.cos(t), z: cz + Math.sin(t) });
  }
  const face = (ax: number, az: number, bx: number, bz: number): void => {
    // Two tris for the vertical quad a(bottom)→b(bottom)→b(top)→a(top); radial
    // outward normals (per-vertex, so the lit surface reads as a smooth curve).
    const na = Math.hypot(ax - cx, az - cz) || 1;
    const nb = Math.hypot(bx - cx, bz - cz) || 1;
    const nax = (ax - cx) / na;
    const naz = (az - cz) / na;
    const nbx = (bx - cx) / nb;
    const nbz = (bz - cz) / nb;
    // a0 b0 b1
    pos.push(ax, 0, az, bx, 0, bz, bx, height, bz);
    nor.push(nax, 0, naz, nbx, 0, nbz, nbx, 0, nbz);
    uv.push(0, 0, 1, 0, 1, 1);
    // a0 b1 a1
    pos.push(ax, 0, az, bx, height, bz, ax, height, az);
    nor.push(nax, 0, naz, nbx, 0, nbz, nax, 0, naz);
    uv.push(0, 0, 1, 1, 0, 1);
  };
  for (let s = 0; s < seg; s++) face(ring[s].x, ring[s].z, ring[s + 1].x, ring[s + 1].z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/**
 * ARC-SWEEP SHELLS — one merged geometry for every multi-tile ArcFeature
 * (arc-sweeps.ts). Each feature contributes a vertical curved band sampled at
 * its exact collider radius/span (see = hit) plus a horizontal cap ring on its
 * SOLID side, so the sweep doesn't read hollow from the iso camera. Merged into
 * a single mesh: draw calls stay constant no matter how many sweeps a floor
 * authors. Grid-space centres are baked into world coords here.
 */
function arcSweepGeometry(arcs: readonly ArcFeature[], grid: Grid, heightFor: (fi: number) => number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const norm: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const wOff = grid.w / 2;
  const hOff = grid.h / 2;
  for (let fi = 0; fi < arcs.length; fi++) {
    const f = arcs[fi];
    const h = heightFor(fi);
    const cxw = f.cx - wOff;
    const czw = f.cz - hOff;
    const seg = Math.max(8, Math.ceil(f.span * f.r * 5));
    const base = pos.length / 3;
    for (let s = 0; s <= seg; s++) {
      const a = f.a0 + (f.span * s) / seg;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const x = cxw + dx * f.r;
      const z = czw + dz * f.r;
      // Normal faces the OPEN side (radially out for a convex guide, in for a
      // concave bowl); the material is DoubleSide so grazing views still fill.
      const nx = f.solidOut ? -dx : dx;
      const nz = f.solidOut ? -dz : dz;
      pos.push(x, 0, z, x, h, z);
      norm.push(nx, 0, nz, nx, 0, nz);
      const u = (f.r * f.span * s) / seg; // arc length in tiles → texture repeat
      uv.push(u, 0, u, 1);
    }
    for (let s = 0; s < seg; s++) {
      const v0 = base + s * 2;
      index.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);
    }
    // Cap ring on the solid side, a hair above the box caps (no z-fight).
    const rIn = f.solidOut ? f.r : Math.max(0.2, f.r - 1.0);
    const rOut = f.solidOut ? f.r + 1.0 : f.r;
    const capBase = pos.length / 3;
    const yTop = h + 0.004;
    for (let s = 0; s <= seg; s++) {
      const a = f.a0 + (f.span * s) / seg;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      pos.push(cxw + dx * rIn, yTop, czw + dz * rIn, cxw + dx * rOut, yTop, czw + dz * rOut);
      norm.push(0, 1, 0, 0, 1, 0);
      const u = (f.r * f.span * s) / seg;
      uv.push(u, 0, u, 1);
    }
    for (let s = 0; s < seg; s++) {
      const v0 = capBase + s * 2;
      index.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

export function buildMaze(scene: THREE.Scene, grid: Grid, plan: LevelPlan, arcs: ArcCorner[] = []): MazeHandle {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ── Floor — one plane under the whole grid ──
  const floorTex = cachedTiled("floor", () => makeFloorTexture(1, 1), grid.w / FLOOR_BLOCK, grid.h / FLOOR_BLOCK);
  const floorNorm = cachedTiled(
    "floor-norm",
    () => normalTexture(TILE_PX * FLOOR_BLOCK, floorHeight, 1, 1, 2.0),
    grid.w / FLOOR_BLOCK,
    grid.h / FLOOR_BLOCK,
  );
  const floorMat = track(
    new THREE.MeshStandardMaterial({
      map: floorTex,
      normalMap: floorNorm,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.95,
      metalness: 0.0,
    }),
  );
  const floorGeo = track(new THREE.PlaneGeometry(grid.w, grid.h));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ── FLOOR SURFACE WASH ──────────────────────────────────────────────────
  //
  // The floor is ONE plane with a tiling texture, so there is no per-tile slot
  // to tint the way walls have instances. Rather than patch the floor shader
  // (which would put a custom material on the single biggest receiveShadow
  // surface in the scene), painted tiles get a second, very thin quad washed
  // over them — one InstancedMesh for the whole floor, and only for tiles that
  // are actually non-stone. An unpainted floor builds nothing and costs nothing.
  //
  // Additive-ish transparency at low opacity so the flagstone texture still
  // reads THROUGH the wash: the point is "this patch is ice", not "this patch
  // is a flat blue rectangle" — the same mistake the card-art tint made.
  //
  // ONE MESH PER MATERIAL, not one mesh with per-instance colours. The old
  // version tinted a single instanced quad, which is why every patch was a flat
  // rectangle: an instanceColor can carry a hue but it cannot carry a GRAIN,
  // and grain is the entire difference between "this patch is ice" and "this
  // patch is blue". A floor uses at most four non-stone materials, so this is
  // at most four extra draw calls for four recognisable substances.
  {
    const byMaterial = new Map<number, Array<{ x: number; z: number }>>();
    for (let j = 0; j < grid.h; j++) {
      for (let i = 0; i < grid.w; i++) {
        if (!isWalkable(grid, i, j)) continue;
        const surf = floorSurface(surfaceAt(grid, i, j));
        if (surf.id === FLOOR_STONE) continue;
        const cc = tileCenter(grid, i, j);
        let cells = byMaterial.get(surf.id);
        if (!cells) byMaterial.set(surf.id, (cells = []));
        cells.push({ x: cc.x, z: cc.z });
      }
    }
    for (const [floorId, cells] of byMaterial) {
      const washGeo = track(new THREE.PlaneGeometry(1, 1));
      washGeo.rotateX(-Math.PI / 2);
      const washMat = track(
        new THREE.MeshBasicMaterial({
          map: makeSurfaceWashTexture(floorId), // cached, session-lived: never tracked
          transparent: true,
          // The texture carries its own per-pixel alpha now, so the blanket
          // 0.42 comes off — that opacity existed to stop a flat colour block
          // from erasing the flagstone, and a grain does not need it.
          opacity: 1,
          depthWrite: false, // a decal, never an occluder
        }),
      );
      const washMesh = new THREE.InstancedMesh(washGeo, washMat, cells.length);
      washMesh.frustumCulled = false; // one object spanning the floor — culling it is all-or-nothing anyway
      const wm = new THREE.Matrix4();
      cells.forEach((c, k) => {
        // Just proud of the floor plane. Too low z-fights, too high and the
        // wash visibly floats off the ground at the camera's 38° tilt.
        wm.setPosition(c.x, 0.012, c.z);
        washMesh.setMatrixAt(k, wm);
      });
      washMesh.instanceMatrix.needsUpdate = true;
      group.add(washMesh);
      disposables.push({ dispose: () => washMesh.dispose() });
    }
  }

  // ── Walls — sort into full (back) and low (camera-side rim) ──
  // Only wall tiles with at least one walkable neighbour (8-way) get an
  // instance: a wall buried inside a solid block can never be seen.
  const fullCells: Array<{ x: number; z: number; i: number; j: number }> = [];
  const mossCells: Array<{ x: number; z: number; i: number; j: number }> = [];
  const lowCells: Array<{ x: number; z: number; i: number; j: number }> = [];
  const southFaces: Array<{ x: number; z: number; i: number; j: number }> = [];
  // Shaped (slant) wall tiles are drawn as triangular prisms, not boxes.
  const slantCells: Array<{ x: number; z: number; i: number; j: number; shape: TileShape; low: boolean }> = [];
  // Per arc-sweep feature: does any of its slices sit on the camera-side rim?
  const arcRim = new Map<number, boolean>();
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      if (isWalkable(grid, i, j)) continue;
      if (at(grid, i, j) === T_CRACKED) continue; // secret bands get their own removable meshes below
      let exposed = false;
      for (let dj = -1; dj <= 1 && !exposed; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (isWalkable(grid, i + di, j + dj)) {
            exposed = true;
            break;
          }
        }
      }
      if (!exposed) continue;
      // The Diablo rule, isometric edition — see engine/grid.ts isLowWall. It
      // lives there rather than here because the croaker's hop reads it too,
      // and a frog clearing a wall this file drew full-height is a bug.
      const rim = isLowWall(grid, i, j);
      const cc = tileCenter(grid, i, j);
      const c = { x: cc.x, z: cc.z, i, j };
      // A SHAPED tile (slant prism / round shell) is built below, never a box.
      const shape = shapeAt(grid, i, j);
      if (isShaped(shape)) {
        if (isArc(shape)) {
          // A multi-tile arc slice — rendered as one feature shell below, not
          // per-tile. Remember whether ANY slice is camera-side rim so the
          // whole sweep takes the knee-high treatment (Diablo rule).
          const fid = grid.arcIdx ? grid.arcIdx[idx(grid, i, j)] : -1;
          if (fid >= 0) arcRim.set(fid, (arcRim.get(fid) ?? false) || rim);
        } else {
          slantCells.push({ x: cc.x, z: cc.z, i, j, shape, low: rim });
        }
        continue;
      }
      if (rim) {
        lowCells.push(c);
      } else if ((i * 7 + j * 13) % 4 === 0) {
        mossCells.push(c); // every ~4th tall wall grows moss — breaks up runs
      } else {
        fullCells.push(c);
      }
      // Tall walls with a corridor to their SOUTH show their big face to the
      // camera — those faces are where the architecture hangs.
      if (!rim && isWalkable(grid, i, j + 1)) southFaces.push({ x: c.x, z: c.z, i, j });
    }
  }

  const capTex = cachedTexture("cap", makeCapTexture);
  const capNorm = cachedTexture("cap-norm", () => normalTexture(TILE_PX, capHeight, 1, 1, 2.5));
  const capMat = track(
    new THREE.MeshStandardMaterial({
      map: capTex,
      normalMap: capNorm,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.95,
      metalness: 0.0,
    }),
  );

  // Tile → the wall instance drawing it, so a high-speed smash (secrets.ts
  // smashWallAt) can pop a single wall out of its InstancedMesh at runtime.
  const wallAt = new Map<string, { mesh: THREE.InstancedMesh; index: number }>();

  /**
   * Wash a wall instance with its SURFACE colour (engine/surfaces.ts), so
   * rubber, ice, mud and brass are visible from across the room. A surface the
   * player cannot see is a bug: a wall that eats your combo without looking any
   * different reads as the physics being broken, not as terrain.
   *
   * Per-instance `instanceColor` rather than a separate material per surface —
   * it keeps the one-draw-call-per-bucket property that makes the maze cheap.
   * Two three.js details this depends on:
   *  - `setColorAt` does NOT colour-space-convert the way `material.color`
   *    setters do, so the hex is built with an explicit SRGBColorSpace or the
   *    tint renders washed out;
   *  - the first `setColorAt` call ALLOCATES `instanceColor` **zero-filled**,
   *    so every instance that never gets written renders BLACK. That is why
   *    the caller decides per BUCKET (`anyTint` below) and then writes every
   *    instance including the stone ones, rather than writing only the
   *    interesting ones and leaving the rest to a default that doesn't exist.
   *    An all-stone bucket skips the call entirely and pays nothing.
   */
  const tintScratch = new THREE.Color();
  const bucketNeedsTint = (cells: Array<{ i: number; j: number }>): boolean =>
    cells.some((c) => wallSurface(surfaceAt(grid, c.i, c.j)).id !== WALL_STONE);
  const tintWall = (mesh: THREE.InstancedMesh, k: number, i: number, j: number): void => {
    const surf = wallSurface(surfaceAt(grid, i, j));
    mesh.setColorAt(k, surf.id === WALL_STONE ? tintScratch.setRGB(1, 1, 1) : tintScratch.setHex(surf.hex, THREE.SRGBColorSpace));
  };

  const addWallMesh = (cells: Array<{ x: number; z: number; i: number; j: number }>, height: number, mossy: boolean): void => {
    if (!cells.length) return;
    const low = height < 0.6;
    // Faces stretch their square texture over the (slightly non-1) wall height
    // rather than repeating — repetition would wrap the trim band into the
    // skirting at the top of the wall. A ~10% stretch is invisible.
    const faceTex = cachedTexture(`wall-${mossy}-${low}`, () => makeWallTexture(mossy, low));
    const lowHeight = (x: number, y: number): number => {
      if (y < 2) return 0.7; // top catch-light sits proud
      if (y >= TILE_PX - 4) return 0.1;
      if (Math.abs(y - 28) < 1.5 || x % 22 < 1.5) return 0.2; // joints
      return 0.5;
    };
    const faceNorm = cachedTexture(`wall-norm-${low}`, () => normalTexture(TILE_PX, low ? lowHeight : wallHeight, 1, 1, 2.5));
    const faceMat = track(
      new THREE.MeshStandardMaterial({
        map: faceTex,
        normalMap: faceNorm,
        normalScale: new THREE.Vector2(1.0, 1.0),
        roughness: 0.92,
        metalness: 0.0,
      }),
    );
    const geo = track(new THREE.BoxGeometry(1, height, 1));
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z — bordered grid cap
    // on top so the coursed texture doesn't smear across a horizontal face.
    const mesh = new THREE.InstancedMesh(geo, [faceMat, faceMat, capMat, capMat, faceMat, faceMat], cells.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const tinted = bucketNeedsTint(cells);
    cells.forEach((c, k) => {
      m.setPosition(c.x, height / 2, c.z);
      mesh.setMatrixAt(k, m);
      wallAt.set(`${c.i},${c.j}`, { mesh, index: k });
      if (tinted) tintWall(mesh, k, c.i, c.j);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    disposables.push({ dispose: () => mesh.dispose() });
  };

  addWallMesh(fullCells, WALL_H, false);
  addWallMesh(mossCells, WALL_H, true);
  addWallMesh(lowCells, WALL_LOW, false);

  // ── Shaped walls — SLANT tiles as triangular prisms (face + cap material),
  // ROUND tiles as capless curved shells (DoubleSide, tied to the real collider
  // arc). Instanced per (shape, height); one geometry per bucket (few tiles). ──
  if (slantCells.length) {
    const makeFace = (low: boolean, curved: boolean): THREE.Material =>
      track(
        new THREE.MeshStandardMaterial({
          map: cachedTexture(`wall-false-${low}`, () => makeWallTexture(false, low)),
          normalMap: cachedTexture("wall-norm-tall", () => normalTexture(TILE_PX, wallHeight, 1, 1, 2.5)),
          normalScale: new THREE.Vector2(1, 1),
          roughness: 0.92,
          metalness: 0,
          side: curved ? THREE.DoubleSide : THREE.FrontSide, // shells are capless
        }),
      );
    const faceFull = makeFace(false, false);
    const faceLow = makeFace(true, false);
    const roundFull = makeFace(false, true);
    const roundLow = makeFace(true, true);
    const buckets = new Map<string, typeof slantCells>();
    for (const c of slantCells) {
      const key = `${c.shape}:${c.low ? 1 : 0}`;
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(c);
    }
    for (const [key, cells] of buckets) {
      const [shapeStr, lowStr] = key.split(":");
      const shape = Number(shapeStr) as TileShape;
      const low = lowStr === "1";
      const height = low ? WALL_LOW : WALL_H;
      const round = isRound(shape);
      const geo = track(round ? roundShellGeometry(shape, height) : slantPrismGeometry(shape, height));
      const mat: THREE.Material | THREE.Material[] = round ? (low ? roundLow : roundFull) : [low ? faceLow : faceFull, capMat];
      const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const m = new THREE.Matrix4();
      const tinted = bucketNeedsTint(cells);
      cells.forEach((c, k) => {
        m.setPosition(c.x, 0, c.z); // base on the floor, xz at tile centre
        mesh.setMatrixAt(k, m);
        wallAt.set(`${c.i},${c.j}`, { mesh, index: k });
        if (tinted) tintWall(mesh, k, c.i, c.j);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      disposables.push({ dispose: () => mesh.dispose() });
    }
  }

  // ── ARC SWEEPS — every multi-tile curved wall as ONE merged mesh, sampled at
  // the exact collider radius/span. Knee-high when any slice is camera-side rim
  // (same Diablo rule as boxes), full otherwise. ──
  let arcKickers: ArcKickerVisual[] = [];
  let arcLanes: ArcLaneVisual[] = [];
  if (grid.arcs && grid.arcs.length) {
    const sweepGeo = arcSweepGeometry(grid.arcs, grid, (fi) => ((arcRim.get(fi) ?? true) ? WALL_LOW : WALL_H));
    if (sweepGeo) {
      track(sweepGeo);
      const sweepMat = track(
        new THREE.MeshStandardMaterial({
          map: cachedTexture("wall-false-false", () => makeWallTexture(false, false)),
          normalMap: cachedTexture("wall-norm-tall", () => normalTexture(TILE_PX, wallHeight, 1, 1, 2.5)),
          normalScale: new THREE.Vector2(1, 1),
          roughness: 0.92,
          metalness: 0,
          side: THREE.DoubleSide,
        }),
      );
      const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat);
      sweepMesh.castShadow = true;
      sweepMesh.receiveShadow = true;
      group.add(sweepMesh);
    }
    // The BOOSTER rubber riding those same sweeps — sampled off the identical
    // circle/height so it hugs the wall the ball actually hits.
    const kick = buildArcKickers(grid.arcs, grid, (fi) => ((arcRim.get(fi) ?? true) ? WALL_LOW : WALL_H));
    if (kick.kickers.length) {
      group.add(kick.group);
      for (const d of kick.disposables) disposables.push(d);
      arcKickers = kick.kickers;
    }
    // …and the BOOSTER LANES riding the concave sweeps, same circle, same rule.
    const lane = buildArcLanes(grid.arcs, grid, (fi) => ((arcRim.get(fi) ?? true) ? WALL_LOW : WALL_H));
    if (lane.lanes.length) {
      group.add(lane.group);
      for (const d of lane.disposables) disposables.push(d);
      arcLanes = lane.lanes;
    }
  }

  // ── Secret CRACKED bands — the smash-through walls. Each 2×2 band is its
  // own Group of per-tile boxes (NOT in the instanced walls) so a pinball
  // impact can remove the whole band at runtime (secrets.ts). Same structural
  // height rule as real walls: rim tiles knee-high, back tiles full — a broken
  // low lip with a cracked tall face reads as crumbling masonry. ──
  const secrets: MazeHandle["secrets"] = [];
  if (plan.secrets.length) {
    const crackMats = new Map<boolean, THREE.MeshStandardMaterial>();
    for (const low of [false, true]) {
      const tex = cachedTexture(`wall-cracked-${low}`, () => makeWallTexture(false, low, true));
      const norm = cachedTexture(`wall-norm-crack-${low}`, () => normalTexture(TILE_PX, low ? capHeight : wallHeight, 1, 1, 2.5));
      crackMats.set(
        low,
        track(
          new THREE.MeshStandardMaterial({
            map: tex,
            normalMap: norm,
            normalScale: new THREE.Vector2(1.0, 1.0),
            roughness: 0.92,
            metalness: 0.0,
          }),
        ),
      );
    }
    const fullGeo = track(new THREE.BoxGeometry(1, WALL_H, 1));
    const lowGeo = track(new THREE.BoxGeometry(1, WALL_LOW, 1));
    for (const s of plan.secrets) {
      const band = new THREE.Group();
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const i = s.i + di;
        const j = s.j + dj;
        const rim = isLowWall(grid, i, j);
        const faceMat = crackMats.get(rim)!;
        const mesh = new THREE.Mesh(rim ? lowGeo : fullGeo, [faceMat, faceMat, capMat, capMat, faceMat, faceMat]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const c = tileCenter(grid, i, j);
        mesh.position.set(c.x, (rim ? WALL_LOW : WALL_H) / 2, c.z);
        band.add(mesh);
      }
      group.add(band);
      const c0 = tileCenter(grid, s.i, s.j);
      secrets.push({ i: s.i, j: s.j, x: c0.x + 0.5, z: c0.z + 0.5, mesh: band });
    }
  }

  // ── Architecture (the Castlevania pass) ─────────────────────────
  // Set-dressing density is what separates an authored dungeon from a tile
  // grid. Everything below is hash-keyed off the tile coords, so a level
  // dresses itself identically on every rebuild.

  const stoneMat = track(new THREE.MeshStandardMaterial({ color: PALETTE_HEX[3], roughness: 0.9 }));

  // Pilasters: engaged columns on tall south faces — shaft + capital + plinth.
  const pilasterAt = southFaces.filter((f) => (f.i * 31 + f.j * 17) % PILASTER_EVERY === 0);
  if (pilasterAt.length) {
    const shaftGeo = track(new THREE.BoxGeometry(0.16, WALL_H + 0.04, 0.12));
    const capGeo = track(new THREE.BoxGeometry(0.26, 0.08, 0.18));
    const m = new THREE.Matrix4();
    const parts: Array<[THREE.BoxGeometry, (f: { x: number; z: number }) => THREE.Matrix4]> = [
      [shaftGeo, (f) => m.identity().setPosition(f.x, (WALL_H + 0.04) / 2, f.z + 0.5 + 0.04)],
      [capGeo, (f) => m.identity().setPosition(f.x, WALL_H - 0.02, f.z + 0.5 + 0.06)],
      [capGeo, (f) => m.identity().setPosition(f.x, 0.05, f.z + 0.5 + 0.06)],
    ];
    for (const [geo, place] of parts) {
      const mesh = new THREE.InstancedMesh(geo, stoneMat, pilasterAt.length);
      mesh.castShadow = true;
      pilasterAt.forEach((f, k) => mesh.setMatrixAt(k, place(f)));
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      disposables.push({ dispose: () => mesh.dispose() });
    }
  }

  // Banners: swallowtail cloth on tall faces, two liveries. Skip pilaster tiles.
  const bannerAt = southFaces.filter(
    (f) => (f.i * 31 + f.j * 17) % PILASTER_EVERY !== 0 && (f.i * 13 + f.j * 41) % BANNER_EVERY === 0,
  );
  if (bannerAt.length) {
    const bannerGeo = track(new THREE.PlaneGeometry(0.46, 0.78));
    for (const arcane of [false, true]) {
      const cells = bannerAt.filter((f) => ((f.i + f.j) % 2 === 0) === arcane);
      if (!cells.length) continue;
      const tex = cachedTexture(`banner-${arcane}`, () => makeBannerTexture(arcane));
      const mat = track(
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 1 }),
      );
      const mesh = new THREE.InstancedMesh(bannerGeo, mat, cells.length);
      const bm = new THREE.Matrix4();
      cells.forEach((f, k) => {
        bm.identity().setPosition(f.x, WALL_H * 0.52, f.z + 0.5 + 0.015);
        mesh.setMatrixAt(k, bm);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      disposables.push({ dispose: () => mesh.dispose() });
    }
  }

  // Clutter: crates and barrels hugging walls in corners and dead ends.
  const torchTiles = new Set(plan.torches.map((t) => `${t.i},${t.j}`));
  const crates: THREE.Matrix4[] = [];
  const barrels: THREE.Matrix4[] = [];
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      if (!isWalkable(grid, i, j)) continue;
      if (i === plan.stairs.i && j === plan.stairs.j) continue;
      if (torchTiles.has(`${i},${j}`)) continue;
      const wE = !isWalkable(grid, i + 1, j);
      const wW = !isWalkable(grid, i - 1, j);
      const wN = !isWalkable(grid, i, j - 1);
      const wS = !isWalkable(grid, i, j + 1);
      const wallCount = +wE + +wW + +wN + +wS;
      if (wallCount < 2) continue;
      const h = (i * 53 + j * 29) % CLUTTER_EVERY;
      if (h !== 0) continue;
      const c = tileCenter(grid, i, j);
      // hug the corner: shove toward the walls so the walk path stays clear
      const ox = wE ? 0.3 : wW ? -0.3 : 0;
      const oz = wS ? 0.3 : wN ? -0.3 : 0;
      const rot = (noise(i, j, 71) - 0.5) * 0.6;
      const mtx = new THREE.Matrix4().makeRotationY(rot);
      mtx.setPosition(c.x + ox, 0.15, c.z + oz);
      if (noise(i, j, 73) > 0.5) crates.push(mtx);
      else barrels.push(mtx);
    }
  }
  if (crates.length) {
    const crateGeo = track(new THREE.BoxGeometry(0.3, 0.3, 0.3));
    const crateTex = cachedTexture("crate", makeCrateTexture);
    const crateMat = track(new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.95 }));
    const mesh = new THREE.InstancedMesh(crateGeo, crateMat, crates.length);
    mesh.castShadow = true;
    crates.forEach((mtx, k) => mesh.setMatrixAt(k, mtx));
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push({ dispose: () => mesh.dispose() });
  }
  if (barrels.length) {
    const barrelGeo = track(new THREE.CylinderGeometry(0.13, 0.15, 0.36, 8));
    const barrelTex = cachedTexture("barrel", makeBarrelTexture);
    const barrelMat = track(new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.9 }));
    const mesh = new THREE.InstancedMesh(barrelGeo, barrelMat, barrels.length);
    mesh.castShadow = true;
    barrels.forEach((mtx, k) => {
      mtx.setPosition(new THREE.Vector3().setFromMatrixPosition(mtx).setY(0.18));
      mesh.setMatrixAt(k, mtx);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push({ dispose: () => mesh.dispose() });
  }

  // ── Stairs down — THE EXIT. It has to be findable from across a big maze
  // (finding it IS the level's objective), so it's not a subtle floor notch:
  // a dark descending pit ringed by arcane pylons with a tall glowing beam
  // shooting up out of it. Cold arcane blue — the only such light in the level,
  // so it reads instantly as "that's the way down", uncanny not cosy. ──
  const sc = tileCenter(grid, plan.stairs.i, plan.stairs.j);
  const voidMat = track(new THREE.MeshBasicMaterial({ color: PALETTE_HEX[0] }));
  const stepMat = track(new THREE.MeshLambertMaterial({ color: PALETTE_HEX[2] }));
  const pitGeo = track(new THREE.PlaneGeometry(1, 1));
  const pit = new THREE.Mesh(pitGeo, voidMat);
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(sc.x, 0.012, sc.z);
  group.add(pit);
  const stepGeo = track(new THREE.BoxGeometry(0.9, 0.05, 0.26));
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(stepGeo, stepMat);
    step.position.set(sc.x, 0.02 - s * 0.005, sc.z - 0.31 + s * 0.31);
    step.scale.setScalar(1 - s * 0.18);
    group.add(step);
  }
  // Four short arcane pylons framing the pit, glowing-capped — a "gate" read.
  const pylonGeo = track(new THREE.BoxGeometry(0.14, 0.7, 0.14));
  const pylonMat = track(new THREE.MeshStandardMaterial({ color: PALETTE_HEX[29], roughness: 0.5, metalness: 0.5 }));
  const capGeo = track(new THREE.BoxGeometry(0.2, 0.12, 0.2));
  const arcaneMat = track(new THREE.MeshBasicMaterial({ color: PALETTE_HEX[31] })); // basic = blooms
  for (const [ox, oz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as const) {
    const pylon = new THREE.Mesh(pylonGeo, pylonMat);
    pylon.position.set(sc.x + ox, 0.35, sc.z + oz);
    group.add(pylon);
    const cap = new THREE.Mesh(capGeo, arcaneMat);
    cap.position.set(sc.x + ox, 0.72, sc.z + oz);
    group.add(cap);
  }
  // A tall translucent beam of arcane light rising out of the pit — the
  // landmark you can see over the knee-high corridor rims from a distance.
  const beamMat = track(new THREE.MeshBasicMaterial({
    color: PALETTE_HEX[31],
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  const beamGeo = track(new THREE.CylinderGeometry(0.22, 0.34, 3.2, 8, 1, true));
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(sc.x, 1.6, sc.z);
  beam.renderOrder = 3;
  group.add(beam);
  // Handed to core for the per-frame pulse + rising-mote feed (see MazeHandle).
  const stairsBeam = { mat: beamMat as THREE.MeshBasicMaterial, mesh: beam, x: sc.x, z: sc.z };
  // The only cold light in the level, always on (not part of the torch pool),
  // now brighter + reaching further so its glow spills into the approach.
  const stairGlow = new THREE.PointLight(PALETTE_HEX[31], 4.0, 5.5, 2);
  stairGlow.position.set(sc.x, 0.6, sc.z);
  group.add(stairGlow);

  // ── Torches — sconce + flame everywhere, lights from a pool ──
  const sconceGeo = track(new THREE.BoxGeometry(0.18, 0.3, 0.18));
  const sconceMat = track(
    new THREE.MeshStandardMaterial({ color: PALETTE_HEX[19], roughness: 0.4, metalness: 0.6 }),
  );
  // Animated flip-book flame, billboarded to the fixed iso camera. Basic
  // (unlit) so a flame is always the brightest thing on screen — the bloom
  // pass turns that brightness into a halo.
  /**
   * ONE flame material for every torch on the floor.
   *
   * The flip-book needed a cloned texture AND a material per torch, purely so
   * each could hold its own `tex.offset.x`. The shader decorrelates by WORLD
   * POSITION (`worldSeed`), so a corridor of torches all burn differently out of
   * a single material and a single uniform — which makes this a net reduction in
   * both pipeline count and per-floor allocation, not just a look change.
   *
   * `depthWrite` stays TRUE and `alphaTest` stays 0.4, matching what the
   * MeshBasicMaterial did. Both are load-bearing: the flame's silhouette lives in
   * the depth buffer, so the pixel pass's depth-edge ink outline draws around it.
   * Dropping either keeps the flame rendering while silently deleting its outline.
   */
  const flameFx = createFireMaterial({
    orientation: "billboard",
    worldSeed: true,
    depthWrite: true,
    alphaTest: 0.4,
    // A tighter cutoff than the floor pools use. Two reasons: a sconce flame
    // should read small and bright rather than as a spreading body of fire, and
    // the dimmest band is the one that composites badly — ember (14) is a
    // desaturated brown, so additively over cool stone it drifts toward the blood
    // family. Culling it here keeps the torch inside the torch ramp. Same class of
    // problem as the pink-fire incident documented in fire.ts, handled by not
    // emitting the offending band at all rather than by another global rule.
    cutoff: 0.3,
    scale: 2.6,
  });
  flameFx.material.side = THREE.DoubleSide;
  disposables.push(flameFx.material);
  const flameGeo = track(new THREE.PlaneGeometry(0.3, 0.34));

  const torchAnchors: TorchAnchor[] = [];
  for (const t of plan.torches) {
    const c = tileCenter(grid, t.i, t.j);
    // Mount on the wall face: shifted almost half a tile toward the wall.
    // Sconce height keys off the wall it hangs on — a sconce floating in the
    // air above a knee-high rim wall would look unmoored.
    const isLowWall = isWalkable(grid, t.i + t.di, t.j + t.dj - 1);
    const wallH = isLowWall ? WALL_LOW + 0.25 : WALL_H;
    const x = c.x + t.di * 0.41;
    const z = c.z + t.dj * 0.41;

    const sconce = new THREE.Mesh(sconceGeo, sconceMat);
    sconce.position.set(x, wallH * 0.62, z);
    sconce.castShadow = true;
    group.add(sconce);

    // Every torch shares one material — see `flameFx` above. No clone, no
    // per-torch phase to track: the shader reads its own world position.
    const flame = new THREE.Mesh(flameGeo, flameFx.material);
    // Billboarding stays BAKED rather than switching to TSL's `billboarding()`.
    // The camera is fixed-ortho, so this is exact, and it is pixel-grid aligned;
    // a per-frame lookAt would reintroduce sub-pixel drift on a sprite whose
    // whole style depends on landing on texel boundaries.
    flame.rotation.order = "YXZ";
    flame.rotation.y = CAMERA_YAW;
    flame.rotation.x = -CAMERA_TILT;
    flame.position.set(x, wallH * 0.62 + 0.3, z);
    flame.renderOrder = 8;
    group.add(flame);

    torchAnchors.push({ x: x - t.di * 0.2, z: z - t.dj * 0.2 });
  }

  // Tight, short-range pools against the strong cold ambient (Phase 0 lesson:
  // wide warm lights turn the cold crypt into a cosy burrow).
  const lightPool: THREE.PointLight[] = [];
  for (let k = 0; k < Math.min(TORCH_LIGHT_POOL, torchAnchors.length); k++) {
    const light = new THREE.PointLight(PALETTE_HEX[16], 6, 6, 2);
    const a = torchAnchors[k];
    light.position.set(a.x, WALL_H * 0.62 + 0.3, a.z);
    group.add(light);
    lightPool.push(light);
  }

  scene.add(group);

  return {
    group,
    torchAnchors,
    lightPool,
    flame: flameFx,
    stairsBeam,
    secrets,
    wallAt,
    arcKickers,
    arcLanes,
    dispose() {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
