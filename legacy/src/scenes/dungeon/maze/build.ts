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
import { PALETTE_HEX } from "../render/palette";
import {
  WALL_H,
  WALL_LOW,
  PPU,
  TORCH_LIGHT_POOL,
  PILASTER_EVERY,
  BANNER_EVERY,
  CLUTTER_EVERY,
  FLAME_FRAMES,
  CAMERA_YAW,
  CAMERA_TILT,
  ARC_WEDGE_R,
} from "../constants";
import { type Grid, isWalkable, tileCenter, at, T_CRACKED } from "./generator";
import type { LevelPlan } from "./decorate";
import type { ArcCorner } from "../collision";
import { clamp } from "../../../utils/math";

/** Deterministic hash-noise — no Math.random, so a level looks identical on rebuild. */
function noise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function pixelTexture(
  size: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  repeatX: number,
  repeatY: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  paint(ctx);

  const tex = new THREE.CanvasTexture(canvas);
  // Cel round: smooth filtering + mipmaps (all sizes here are powers of two).
  // Nearest-filtered texels were half of what still read as "pixel art", and
  // mipmapping kills the moiré the tilted camera used to make of the floor.
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
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
  return tex;
}

// ── Height fields (mirror the diffuse painters above) ────────────
/** Flagstones: mortar seams are grooves, each stone domes gently to its centre. */
function floorHeight(x: number, y: number): number {
  const lx = x % PPU;
  const ly = y % PPU;
  const d = Math.min(lx, PPU - lx, ly, PPU - ly);
  if (d < 1.5) return 0.12; // mortar groove
  return 0.5 + (Math.min(d, 12) / 12) * 0.22; // dome toward the stone's middle
}
/** Wall face: mirrors the masonry layout — trim proud, mortar grooved, skirting recessed. */
function wallHeight(x: number, y: number): number {
  if (y >= PPU - 3) return 0.05; // contact shadow row — deepest
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
  if (x < 2 || x > PPU - 2 || y < 2 || y > PPU - 2) return 0.15;
  const onPanel =
    (Math.abs(x - 10) < 1.5 || Math.abs(x - (PPU - 10)) < 1.5) && y >= 9 && y <= PPU - 9;
  const onPanelH =
    (Math.abs(y - 10) < 1.5 || Math.abs(y - (PPU - 10)) < 1.5) && x >= 9 && x <= PPU - 9;
  if (onPanel || onPanelH) return 0.4;
  return 0.6;
}

const css = (i: number) => `#${PALETTE_HEX[i].toString(16).padStart(6, "0")}`;

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
  const size = PPU * FLOOR_BLOCK;
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
          const x0 = ti * PPU;
          const y0 = tj * PPU;

          // Patchwork: some flagstones are simply a different cut of stone.
          const patch = noise(ti * 7.3, tj * 2.9, 61);
          if (patch < 0.14) {
            ctx.fillStyle = css(2);
            ctx.fillRect(x0 + 1, y0 + 1, PPU - 2, PPU - 2);
          } else if (patch > 0.9) {
            ctx.fillStyle = css(4);
            ctx.fillRect(x0 + 1, y0 + 1, PPU - 2, PPU - 2);
            for (let k = 0; k < 40; k++) {
              const sx = x0 + 1 + Math.floor(noise(ti + k, tj, 63) * (PPU - 2));
              const sy = y0 + 1 + Math.floor(noise(ti, tj + k, 65) * (PPU - 2));
              ctx.fillStyle = css(3);
              ctx.fillRect(sx, sy, 1, 1);
            }
          }

          // Mosaic medallion — an inlaid arcane diamond, rare enough to be a
          // landmark ("I've passed this one before").
          if (h > 0.4 && h < 0.455) {
            const cx = x0 + PPU / 2;
            const cy = y0 + PPU / 2;
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
            for (let y = 2; y < PPU - 2; y++) {
              for (let x = 2; x < PPU - 2; x++) {
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
            for (let y = 4; y < PPU - 4; y++) {
              ctx.fillStyle = css(1);
              ctx.fillRect(x0 + cx, y0 + y, 1, 1);
              cx += noise(cx, y0 + y, 11) > 0.5 ? 1 : noise(cx, y0 + y, 12) > 0.5 ? -1 : 0;
              cx = clamp(cx, 2, PPU - 3);
            }
          } else if (h > 0.76) {
            // sunken tile — a shade darker, catches the eye like wear
            ctx.fillStyle = "rgba(11, 13, 18, 0.28)";
            ctx.fillRect(x0 + 1, y0 + 1, PPU - 2, PPU - 2);
          }
        }
      }

      // Mortar seams at one-tile pitch, with a light chip under each horizontal
      // seam so the flagstones read as bevelled rather than printed.
      for (let i = 0; i < FLOOR_BLOCK; i++) {
        const p = i * PPU;
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
    let cx = PPU / 2 - 3;
    for (let y = 2; y < PPU - 2; y++) {
      ctx.fillStyle = css(0);
      ctx.fillRect(cx, y, 2, 1);
      // a thin side-branch halfway down
      if (y === Math.floor(PPU / 2)) {
        let bx = cx;
        for (let k = 0; k < 12; k++) {
          bx += 1;
          ctx.fillRect(bx, y - Math.floor(k / 2), 1, 1);
        }
      }
      cx += noise(cx, y, 57) > 0.5 ? 1 : noise(cx, y, 58) > 0.5 ? -1 : 0;
      cx = clamp(cx, 6, PPU - 8);
      // gold glints scattered along the crack lips
      if (noise(cx, y, 59) > 0.82) {
        ctx.fillStyle = css(16);
        ctx.fillRect(cx + (noise(y, cx, 60) > 0.5 ? 2 : -1), y, 1, 1);
      }
    }
  };

  return pixelTexture(
    PPU,
    (ctx) => {
      ctx.fillStyle = css(2);
      ctx.fillRect(0, 0, PPU, PPU);

      if (low) {
        // Knee wall: one course of small blocks + top highlight + base shadow.
        ctx.fillStyle = css(1);
        for (let bx = 0; bx <= PPU; bx += 22) ctx.fillRect(bx, 0, 1, PPU);
        ctx.fillRect(0, 28, PPU, 1);
        ctx.fillStyle = css(4);
        ctx.fillRect(0, 0, PPU, 2); // top catch-light
        ctx.fillStyle = css(0);
        ctx.fillRect(0, PPU - 4, PPU, 4);
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
        for (let bx = -BLOCK_W; bx < PPU + BLOCK_W; bx += BLOCK_W) {
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
        ctx.fillRect(0, cy, PPU, 1);
      });

      // ── carved trim course along the top ──
      ctx.fillStyle = css(3);
      ctx.fillRect(0, 0, PPU, TRIM_H);
      ctx.fillStyle = css(4);
      ctx.fillRect(0, 0, PPU, 1); // top catch-light
      ctx.fillStyle = css(1);
      ctx.fillRect(0, TRIM_H - 1, PPU, 1);
      for (let dx = 3; dx < PPU; dx += 8) {
        ctx.fillStyle = css(1);
        ctx.fillRect(dx, 2, 2, TRIM_H - 4); // dentil notches
      }

      // ── skirting base course ──
      ctx.fillStyle = css(1);
      ctx.fillRect(0, SKIRT_Y, PPU, PPU - SKIRT_Y);
      ctx.fillStyle = css(3);
      ctx.fillRect(0, SKIRT_Y, PPU, 1); // ledge highlight
      ctx.fillStyle = css(2);
      for (let bx = 8; bx < PPU; bx += 16) ctx.fillRect(bx, SKIRT_Y + 3, 1, 6); // joints

      if (mossy) {
        // Damp rot climbing from the floor — denser at the bottom.
        for (let y = PPU / 2; y < PPU; y++) {
          const density = (y - PPU / 2) / (PPU / 2);
          for (let x = 0; x < PPU; x++) {
            if (noise(x, y, 21) < density * 0.5) {
              ctx.fillStyle = css(noise(x, y, 23) > 0.6 ? 7 : 6);
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      // Contact shadow along the bottom of the face — grounds the wall.
      ctx.fillStyle = css(0);
      ctx.fillRect(0, PPU - 3, PPU, 3);

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
    PPU,
    (ctx) => {
      ctx.fillStyle = css(2);
      ctx.fillRect(0, 0, PPU, PPU);

      // sparse chips
      for (let y = 2; y < PPU - 2; y++) {
        for (let x = 2; x < PPU - 2; x++) {
          if (noise(x, y, 13) > 0.96) {
            ctx.fillStyle = css(3);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // tile border — the grid line
      ctx.fillStyle = css(1);
      ctx.fillRect(0, 0, PPU, 1);
      ctx.fillRect(0, PPU - 1, PPU, 1);
      ctx.fillRect(0, 0, 1, PPU);
      ctx.fillRect(PPU - 1, 0, 1, PPU);
      // top bevel just inside the border (north edge catches the "light")
      ctx.fillStyle = css(4);
      ctx.fillRect(1, 1, PPU - 2, 1);

      // carved inner panel — an inset square with nicked corners, so caps
      // read as dressed stone instead of blank slabs
      ctx.strokeStyle = css(1);
      ctx.lineWidth = 1;
      ctx.strokeRect(9.5, 9.5, PPU - 19, PPU - 19);
      ctx.strokeStyle = css(3);
      ctx.strokeRect(10.5, 10.5, PPU - 21, PPU - 21);
      ctx.fillStyle = css(1);
      for (const [cx, cy] of [[9, 9], [PPU - 11, 9], [9, PPU - 11], [PPU - 11, PPU - 11]] as const) {
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
 * Torch flame flip-book: FLAME_FRAMES teardrop frames in one horizontal strip.
 * Layered palette tongues (ember → core) with a per-frame lean and tip lick —
 * the classic Castlevania wall-torch. Drawn bright so the bloom pass halos it.
 */
function makeFlameTexture(): THREE.CanvasTexture {
  const F = 32;
  const canvas = document.createElement("canvas");
  canvas.width = F * FLAME_FRAMES;
  canvas.height = F;
  const ctx = canvas.getContext("2d")!;
  const lean = [0, 2.5, 0.5, -2.5];
  const lick = [0, 3, 1, 3];
  for (let f = 0; f < FLAME_FRAMES; f++) {
    const ox = f * F + F / 2;
    const base = F - 4;
    const tongue = (w: number, h: number, col: string, dx: number): void => {
      ctx.beginPath();
      ctx.moveTo(ox - w + dx * 0.3, base);
      ctx.quadraticCurveTo(ox - w + dx * 0.6, base - h * 0.55, ox + dx, base - h);
      ctx.quadraticCurveTo(ox + w + dx * 0.6, base - h * 0.55, ox + w + dx * 0.3, base);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    };
    const L = lean[f % lean.length];
    tongue(8, 24 + lick[f % lick.length], css(15), L);
    tongue(6, 18 + lick[(f + 1) % lick.length], css(16), L * 0.7);
    tongue(4, 12, css(17), L * 0.45);
    tongue(2, 7, css(18), L * 0.25);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
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
  /** Flip-book flame textures — core advances their frame offset each frame. */
  flames: Array<{ tex: THREE.Texture; phase: number }>;
  /**
   * The still-intact secret bands: (i,j) = the 2×2 band's top-left tile, (x,z)
   * its world centre, mesh the removable Group. secrets.ts splices entries as
   * they're smashed; geometry/materials stay tracked for level disposal.
   */
  secrets: Array<{ i: number; j: number; x: number; z: number; mesh: THREE.Object3D }>;
  /** Tile "i,j" → the wall InstancedMesh + instance index drawing it, so a
   * high-speed smash can hide one wall at runtime (secrets.ts smashWallAt). */
  wallAt: Map<string, { mesh: THREE.InstancedMesh; index: number }>;
  dispose(): void;
}

export function buildMaze(scene: THREE.Scene, grid: Grid, plan: LevelPlan, arcs: ArcCorner[] = []): MazeHandle {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ── Floor — one plane under the whole grid ──
  const floorTex = track(makeFloorTexture(grid.w / FLOOR_BLOCK, grid.h / FLOOR_BLOCK));
  const floorNorm = track(
    normalTexture(PPU * FLOOR_BLOCK, floorHeight, grid.w / FLOOR_BLOCK, grid.h / FLOOR_BLOCK, 2.0),
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

  // ── Walls — sort into full (back) and low (camera-side rim) ──
  // Only wall tiles with at least one walkable neighbour (8-way) get an
  // instance: a wall buried inside a solid block can never be seen.
  const fullCells: Array<{ x: number; z: number; i: number; j: number }> = [];
  const mossCells: Array<{ x: number; z: number; i: number; j: number }> = [];
  const lowCells: Array<{ x: number; z: number; i: number; j: number }> = [];
  const southFaces: Array<{ x: number; z: number; i: number; j: number }> = [];
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
      // The Diablo rule, isometric edition: the camera sits to the world's
      // south-east, so a wall occludes corridors to its NORTH and WEST. Floor
      // on either of those sides makes this a camera-side rim → knee-high.
      const rim = isWalkable(grid, i, j - 1) || isWalkable(grid, i - 1, j);
      const cc = tileCenter(grid, i, j);
      const c = { x: cc.x, z: cc.z, i, j };
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

  const capTex = track(makeCapTexture());
  const capNorm = track(normalTexture(PPU, capHeight, 1, 1, 2.5));
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

  const addWallMesh = (cells: Array<{ x: number; z: number; i: number; j: number }>, height: number, mossy: boolean): void => {
    if (!cells.length) return;
    const low = height < 0.6;
    // Faces stretch their square texture over the (slightly non-1) wall height
    // rather than repeating — repetition would wrap the trim band into the
    // skirting at the top of the wall. A ~10% stretch is invisible.
    const faceTex = track(makeWallTexture(mossy, low));
    const lowHeight = (x: number, y: number): number => {
      if (y < 2) return 0.7; // top catch-light sits proud
      if (y >= PPU - 4) return 0.1;
      if (Math.abs(y - 28) < 1.5 || x % 22 < 1.5) return 0.2; // joints
      return 0.5;
    };
    const faceNorm = track(normalTexture(PPU, low ? lowHeight : wallHeight, 1, 1, 2.5));
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
    cells.forEach((c, k) => {
      m.setPosition(c.x, height / 2, c.z);
      mesh.setMatrixAt(k, m);
      wallAt.set(`${c.i},${c.j}`, { mesh, index: k });
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push({ dispose: () => mesh.dispose() });
  };

  addWallMesh(fullCells, WALL_H, false);
  addWallMesh(mossCells, WALL_H, true);
  addWallMesh(lowCells, WALL_LOW, false);

  // ── Secret CRACKED bands — the smash-through walls. Each 2×2 band is its
  // own Group of per-tile boxes (NOT in the instanced walls) so a pinball
  // impact can remove the whole band at runtime (secrets.ts). Same structural
  // height rule as real walls: rim tiles knee-high, back tiles full — a broken
  // low lip with a cracked tall face reads as crumbling masonry. ──
  const secrets: MazeHandle["secrets"] = [];
  if (plan.secrets.length) {
    const crackMats = new Map<boolean, THREE.MeshStandardMaterial>();
    for (const low of [false, true]) {
      const tex = track(makeWallTexture(false, low, true));
      const norm = track(normalTexture(PPU, low ? capHeight : wallHeight, 1, 1, 2.5));
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
        const rim = isWalkable(grid, i, j - 1) || isWalkable(grid, i - 1, j);
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
      const tex = track(makeBannerTexture(arcane));
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
    const crateTex = track(makeCrateTexture());
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
    const barrelTex = track(makeBarrelTexture());
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
  const flameStrip = track(makeFlameTexture());
  const flameGeo = track(new THREE.PlaneGeometry(0.3, 0.34));
  const flames: Array<{ tex: THREE.Texture; phase: number }> = [];

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

    // Each flame clones the strip so its flip-book frame is independent.
    const tex = flameStrip.clone();
    tex.needsUpdate = true;
    tex.repeat.set(1 / FLAME_FRAMES, 1);
    disposables.push(tex);
    const flameMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    disposables.push(flameMat);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.rotation.order = "YXZ";
    flame.rotation.y = CAMERA_YAW;
    flame.rotation.x = -CAMERA_TILT;
    flame.position.set(x, wallH * 0.62 + 0.3, z);
    flame.renderOrder = 8;
    group.add(flame);
    flames.push({ tex, phase: noise(t.i, t.j, 91) });

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

  // ── Curved walls — a FULL-HEIGHT quarter-cylinder that rounds each banked
  // corner (collision.computeArcCorners), so the concave corner where two walls
  // meet reads as a swept pinball return lane instead of a right angle. Physics
  // is the point-trigger bank in player.ts; this is the visual, and every one
  // sits on a genuinely sweepable corner (a ≥2×2 open pocket).
  //
  // NB (2026-07-20): an earlier pass drew this half-height with an emissive-gold
  // rim torus riding the top — the wedge got buried by the full-height walls and
  // only the rim showed, as a gold arc FLOATING in mid-air with nothing under
  // it. Full-height + wall material + no floating rim = it reads as a wall.
  if (arcs.length) {
    const wedgeH = WALL_H; // full wall height — the rounded corner IS the wall here
    // Quarter cylinder: axis = the corner's right angle, curved face bulging in.
    const wedgeGeo = track(new THREE.CylinderGeometry(ARC_WEDGE_R, ARC_WEDGE_R + 0.06, wedgeH, 14, 1, false, 0, Math.PI / 2));
    const wedgeTex = track(makeCapTexture());
    const wedgeMat = track(new THREE.MeshStandardMaterial({ map: wedgeTex, color: PALETTE_HEX[4], roughness: 0.85, metalness: 0.0 }));
    const wedge = new THREE.InstancedMesh(wedgeGeo, wedgeMat, arcs.length);
    wedge.castShadow = true;
    wedge.receiveShadow = true;
    // The default quarter fills the (+x,+z) quadrant from its axis; rotate so it
    // faces the OPEN interior of each corner (see collision.ts qi/qj).
    const rotFor = (qi: number, qj: number): number =>
      qi === 1 && qj === 0 ? -Math.PI / 2 : qi === 0 && qj === 0 ? 0 : qi === 1 && qj === 1 ? Math.PI : Math.PI / 2;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    arcs.forEach((a, k) => {
      const cxr = a.cx + (a.qi === 1 ? 0.5 : -0.5); // the crook corner point
      const czr = a.cz + (a.qj === 1 ? 0.5 : -0.5);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotFor(a.qi, a.qj));
      pos.set(cxr, wedgeH / 2, czr);
      m.compose(pos, q, one);
      wedge.setMatrixAt(k, m);
    });
    wedge.instanceMatrix.needsUpdate = true;
    group.add(wedge);
    disposables.push({ dispose: () => wedge.dispose() });
  }

  scene.add(group);

  return {
    group,
    torchAnchors,
    lightPool,
    flames,
    secrets,
    wallAt,
    dispose() {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
