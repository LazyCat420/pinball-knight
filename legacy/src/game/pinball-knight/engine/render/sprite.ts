/**
 * Cel painters → CanvasTexture atlas → billboarded sprite.
 *
 * All of an actor's frames are painted into ONE horizontal strip canvas, so the
 * whole actor is a single texture and animating is just an offset of
 * `texture.offset.x`. No per-frame texture swaps, no extra draw calls.
 *
 * Each frame is painted on its own scratch canvas first, then blitted into the
 * strip — the cel-shading pass composites `source-atop` over "everything drawn
 * so far", which on a shared strip would bleed onto neighbouring frames.
 *
 * BILLBOARDING: the camera is a fixed-angle orthographic camera, so we do NOT
 * need true per-frame billboarding. We tilt each sprite plane once, by exactly
 * the camera's elevation, and it faces the camera forever. That's cheaper, and
 * it keeps sprites aligned with the render target's texel grid.
 *
 * The geometry's origin is at the BOTTOM-CENTRE (not the centre), so a sprite
 * positioned at a floor point has its feet on that point, and tilting it back
 * to face the camera pivots around the feet rather than sliding them.
 */
import * as THREE from "three";
import type { ActorPaints, Dir, ClipName, FramePaint } from "./paint-types";
import { enginePalette } from "../palette-source";
import { engineConfig } from "../config";

// Local aliases for the injected tuning. These are read at module load, which
// is correct for geometry that is itself built once and shared (the sprite
// quads below); a game that wants different sprite metrics must inject before
// the first sprite is created, which the boot path guarantees.
const { px: SPRITE_PX, units: SPRITE_UNITS, pixelGrid: SPRITE_PIXEL_GRID, maxAtlasWidth: MAX_ATLAS_WIDTH } =
  engineConfig.sprite;
const { tilt: CAMERA_TILT, yaw: CAMERA_YAW } = engineConfig.camera;

/**
 * Face the isometric camera exactly: yaw to the camera's heading, then tilt
 * back by its elevation (rotation order YXZ makes the X tilt local). Because
 * the camera is orthographic and the plane ends up perpendicular to the view
 * ray, sprite texels stay square on screen. Rotation pivots on the
 * bottom-centre origin — the feet stay planted.
 *
 * This is the DEFAULT orientation — it's baked once (the iso camera never
 * moves). The FPS ultimate temporarily overrides it per-frame (faceCameraYaw).
 */
function faceCamera(mesh: THREE.Mesh): void {
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = CAMERA_YAW;
  mesh.rotation.x = -CAMERA_TILT;
}

/**
 * Billboard an actor plane UPRIGHT toward a camera position on the ground —
 * yaw-only, no tilt, so the sprite stands vertical and faces the viewer square.
 * Used only during the first-person rampage, where the camera can look any
 * direction and the baked iso tilt would show the sprites edge-on / skewed.
 * `mesh` already positioned at the actor; we rotate about its bottom-centre.
 */
export function faceCameraYaw(mesh: THREE.Mesh, camX: number, camZ: number): void {
  const dx = camX - mesh.position.x;
  const dz = camZ - mesh.position.z;
  mesh.rotation.order = "YXZ";
  mesh.rotation.x = 0; // upright
  mesh.rotation.z = 0;
  mesh.rotation.y = Math.atan2(dx, dz); // face the camera on the ground plane
}

/** Restore an actor plane to the baked iso orientation (leaving rampage). */
export function faceCameraIso(mesh: THREE.Mesh): void {
  faceCamera(mesh);
}

/**
 * SHARED SPRITE RESOURCES.
 *
 * Every actor used to allocate its own quad geometry, its own contact-blob
 * geometry and its own blob material — for shapes that are byte-identical
 * across the entire horde. At the ~175-zombie cap that is ~350 geometries and
 * ~175 materials describing two distinct rectangles.
 *
 * These are module singletons, built on first use and never disposed: they
 * outlive any single floor deliberately, since the next floor needs the exact
 * same two rectangles and rebuilding them per descent is what this removes.
 * A per-actor `dispose()` must therefore NEVER dispose these — see
 * `ActorSprite.dispose`, which now only drops what it uniquely owns (its
 * cloned texture and its material).
 *
 * The blob's TEXTURE was already shared; the geometry and material were not.
 */
let sharedSpriteGeo: THREE.PlaneGeometry | null = null;
function spriteGeometry(): THREE.PlaneGeometry {
  if (sharedSpriteGeo) return sharedSpriteGeo;
  const geo = new THREE.PlaneGeometry(SPRITE_UNITS, SPRITE_UNITS);
  // Origin at the bottom-centre so the sprite stands ON its position. Baked
  // into the shared geometry because it is the same for every actor.
  geo.translate(0, SPRITE_UNITS / 2, 0);
  sharedSpriteGeo = geo;
  return geo;
}

let sharedBlobGeo: THREE.PlaneGeometry | null = null;
function blobGeometry(): THREE.PlaneGeometry {
  if (sharedBlobGeo) return sharedBlobGeo;
  sharedBlobGeo = new THREE.PlaneGeometry(SPRITE_UNITS * 0.62, SPRITE_UNITS * 0.62);
  return sharedBlobGeo;
}

let sharedBlobMat: THREE.MeshBasicMaterial | null = null;
function blobMaterial(): THREE.MeshBasicMaterial {
  if (sharedBlobMat) return sharedBlobMat;
  sharedBlobMat = new THREE.MeshBasicMaterial({
    map: blobTexture(),
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  return sharedBlobMat;
}

/**
 * Soft round contact-shadow texture, built once and shared by every actor. A
 * radial black-to-transparent gradient; the blob that carries it is tinted and
 * laid flat on the floor under an actor's feet so the billboard reads as
 * standing ON the ground rather than floating in front of it.
 */
let sharedBlobTexture: THREE.CanvasTexture | null = null;
export function blobTexture(): THREE.CanvasTexture {
  if (sharedBlobTexture) return sharedBlobTexture;
  const s = 64;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(0,0,0,0.6)");
  g.addColorStop(0.55, "rgba(0,0,0,0.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedBlobTexture = tex;
  return tex;
}

/**
 * Build the flat contact-shadow blob for an actor and parent it to the
 * billboard. Because the orthographic camera never rotates, the billboard's
 * rotation is a CONSTANT, so a single baked quaternion counter-rotates the
 * blob to lie flat on the floor — no per-frame work, and it follows the actor
 * automatically as a child.
 */
/**
 * The per-actor blob mesh — the ONLY contact-shadow path there is.
 *
 * This comment used to promise an `installBlobPool` that "swaps in the
 * instanced path for the dungeon, where the actor count actually matters".
 * There was no such function. `engine/render/blob-pool.ts` existed, was 169
 * lines, was covered by its own test, and had zero call sites anywhere — so
 * every actor on every floor has always allocated its own blob mesh, and this
 * note told the next reader not to worry about it. The pool is deleted; if the
 * 175-actor case ever needs instancing, it should be written against the code
 * that is actually running rather than found in a comment.
 */
function makeContactBlob(parent: THREE.Mesh): THREE.Mesh {
  const blob = new THREE.Mesh(blobGeometry(), blobMaterial());
  blob.renderOrder = 6; // above the floor, below the actor (10)

  const inv = parent.quaternion.clone().invert();
  const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  blob.quaternion.copy(inv.clone().multiply(flat)); // net world orientation = flat on the ground
  blob.position.copy(new THREE.Vector3(0, 0.02, 0).applyQuaternion(inv)); // 2cm above the feet
  parent.add(blob);
  return blob;
}

export interface SpriteSheet {
  texture: THREE.CanvasTexture;
  /** clipKey `${dir}:${clip}` → the frame indices in the atlas */
  clips: Map<string, number[]>;
  frameCount: number;
  /** Atlas grid dimensions — frames wrap into rows once a strip would exceed
   *  the GPU's max texture width. */
  cols: number;
  rows: number;
}

/** Nearest filtering — authored pixels must stay square on screen. */
function celFilters(tex: THREE.CanvasTexture): void {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
}

// Palette as RGB triplets for the pixelate pass, with the same luma weighting
// the screen-space quantizer uses.
//
// Resolved lazily and memoised, not captured at module load: the game installs
// its palette during boot, which happens after this module is first imported.
// Capturing here would silently quantize every sprite against the greyscale
// fallback — a bug that renders, so it would not announce itself.
let _palRgb: number[][] | null = null;
function palRgb(): number[][] {
  if (!_palRgb) _palRgb = enginePalette.hex().map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
  return _palRgb;
}

/**
 * THE SNAP LOOKUP TABLE — the atlas build's whole cost, paid once.
 *
 * `crushToGrid` snapped every texel by scanning all 32 palette entries: 72×72
 * pixels × 32 entries × 3 multiply-subtracts is ~166k operations PER FRAME, and
 * a session builds roughly a thousand frames across the monster roster (nine
 * cosmetic zombie variants alone are nine sheets). That inner loop is
 * effectively the whole of `buildMonsterSheets`, and it runs synchronously
 * during a boot that a headless run already measures at 32-36 SECONDS to the
 * first frame — on the wrong side of `playtest.mjs`'s wait, which is how this
 * became visible.
 *
 * The snap is a pure function of a colour, so it is a table: 6 bits per channel,
 * 262144 one-byte entries, a 4-unit cell evaluated at its CENTRE. Building it
 * is 8.4M operations ONCE and every texel afterwards is a single array index.
 *
 * ── WHY IT IS EXACT AND NOT MERELY CLOSE ─────────────────────────────────────
 *
 * A centre-sampled table alone is NOT the same picture. Measured over the whole
 * roster it puts 2.2% of texels on the second-nearest entry instead of the
 * nearest — visually indistinguishable (the differences land on antialiased
 * silhouette edges and the contact shadow, always between two adjacent dark
 * entries) but not identical, and "the art quietly changed and I decided it was
 * fine" is not a trade this file should make silently for a boot-time win.
 *
 * So each cell also stores whether its answer is PROVABLE. During the same
 * 32-entry scan we keep the second-nearest distance as well; if
 *
 *     sqrt(d2) - sqrt(d1) > 2·R,   R = the largest weighted distance from the
 *                                      cell centre to any point in the cell
 *
 * then no colour inside that cell can possibly prefer a different entry, and
 * the cached answer is correct for every one of them. Cells that fail the test
 * store a sentinel and fall through to the exact scan. ~97% of texels take one
 * array read; the remaining ~3% cost what they always cost; the output is
 * byte-identical to the old code by construction rather than by inspection.
 *
 * Keyed on the live palette, so `setEnginePalette` invalidating `_palRgb` must
 * invalidate this too — hence both are cleared together.
 */
const LUT_BITS = 6;
const LUT_N = 1 << LUT_BITS; // 64 steps per channel
const LUT_STEP = 256 / LUT_N; // 4 units per cell
/** No palette has 255 entries — this means "not provable, scan it". */
const LUT_SCAN = 255;
/**
 * Half the weighted diagonal of one cell: the furthest a colour inside a cell
 * can be from its centre under the luma-weighted metric the snap uses.
 */
const LUT_R = 0.5 * Math.sqrt((0.3 * LUT_STEP) ** 2 + (0.59 * LUT_STEP) ** 2 + (0.11 * LUT_STEP) ** 2);
let _snapLut: Uint8Array | null = null;
function snapLut(): Uint8Array {
  if (_snapLut) return _snapLut;
  const PAL = palRgb();
  const lut = new Uint8Array(LUT_N * LUT_N * LUT_N);
  for (let r = 0; r < LUT_N; r++) {
    const cr = r * LUT_STEP + LUT_STEP / 2;
    for (let g = 0; g < LUT_N; g++) {
      const cg = g * LUT_STEP + LUT_STEP / 2;
      for (let b = 0; b < LUT_N; b++) {
        const cb = b * LUT_STEP + LUT_STEP / 2;
        let best = 0;
        let d1 = Infinity;
        let d2 = Infinity;
        for (let p = 0; p < PAL.length; p++) {
          const dr = (cr - PAL[p][0]) * 0.3;
          const dg = (cg - PAL[p][1]) * 0.59;
          const db = (cb - PAL[p][2]) * 0.11;
          const dist = dr * dr + dg * dg + db * db;
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
            best = p;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
        lut[(r << (LUT_BITS * 2)) | (g << LUT_BITS) | b] =
          Math.sqrt(d2) - Math.sqrt(d1) > 2 * LUT_R ? best : LUT_SCAN;
      }
    }
  }
  _snapLut = lut;
  return lut;
}

/**
 * Drop the memoised palette derivations. A game that installs its palette after
 * the first sprite was built (only tests do this) must call it, or every later
 * atlas quantizes against the palette the first one saw.
 */
export function invalidatePaletteCaches(): void {
  _palRgb = null;
  _snapLut = null;
}

/**
 * 4×4 ordered (Bayer) dither matrix, centred to −0.5..+0.5. Nudging each pixel's
 * colour by a per-position bias BEFORE the palette snap makes a smooth tonal
 * ramp break into a stippled checker between two palette steps — the classic
 * pixel-art tone blend — instead of a hard band or a smeared gradient. This is
 * the biggest lever against the "flash-game airbrush" read on large surfaces.
 */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v / 16 - 0.5)));
/**
 * Dither amplitude in 0-255 colour units.
 *
 * Pulled back from 26 (2026-07-19). Ordered dither earns its keep on large
 * flat surfaces, but on a small ANIMATED character it mostly reads as noise —
 * and worse, the pattern crawls between frames, which is exactly the "muddy"
 * artifact it was supposed to prevent. At the old 52px grid it was also doing
 * work the resolution couldn't support. Kept, gently, to break banding on the
 * broad shaded areas; dropped low enough that it no longer stipples a face.
 */
const DITHER_AMP = 10;

/**
 * THE CRUSH PASS (2026-07-14 Castlevania round; reworked 2026-07-19).
 *
 * Actor cels are painted as smooth 128px vector art, then crushed ONCE to a
 * SPRITE_PIXEL_GRID canvas — area-downscale, hard alpha cutout, ordered
 * dither, snap every pixel to the 32-colour palette. Smooth curves become
 * authored-looking pixel clusters; translucent painter effects either commit
 * to a palette colour or disappear. This is what killed the "flash game" read.
 *
 * Returns the SMALL canvas. It used to nearest-upscale the result back into
 * the 128px source and hand THAT to the GPU, which then minified it to ~70px
 * on screen. Three resamplings — 128→52 (0.41×), 52→128 (2.46×, so the stored
 * "pixels" were unevenly 2 and 3 texels wide), then 128→70.4 (0.55×) — to
 * display 52 pixels of art. The middle step added no information and the last
 * one threw away 45% of the texels by point-sampling, differently every frame
 * the actor moved. That was the muddiness, and the crawl under motion.
 *
 * Now the art IS the texture: one resample, at the grid the art was authored
 * for, mapped 1:1 to screen pixels via SPRITE_UNITS.
 */
/**
 * The shared crush target, used ONLY by the immediate-consumer path below.
 *
 * ⚠️ WHY THIS IS NOT SIMPLY `crushToGrid`'s OUTPUT — read before "simplifying".
 *
 * `crushToGrid`'s return value is not always consumed immediately.
 * `staticTexture()` does `new THREE.CanvasTexture(crushToGrid(canvas))` and
 * caches it: that RETAINS the canvas as a live texture source for the session.
 * If that caller got the shared canvas, every cached item texture would end up
 * showing whichever sprite was crushed last — the tavern shop's icons all
 * turning into the same picture. It reads as an art bug and would never be
 * looked for in a perf change.
 *
 * So `crushToGrid` still returns a canvas the caller OWNS, and the reuse lives
 * in `crushToGridShared`, whose one caller (`paintFrame`) blits it on the very
 * next line. That is where the win is anyway: 824 of the ~830 crushes in a load
 * are atlas frames.
 */
/**
 * A 2D context for a canvas that will be CRUSHED — i.e. one whose pixels are
 * about to be read back by `crushInto`.
 *
 * ⚠️ `willReadFrequently` belongs on the SOURCE, not just on the destination.
 * That is the whole point of this helper, and it is the opposite of the
 * intuition (the source is only ever *written*).
 *
 * MEASURED (host Chrome, RTX 3090 Ti, 400 crushes of a 128px paint box down to
 * the 72px grid, timing `getImageData` alone):
 *
 *     paint canvas GPU-backed   → getImageData  2.271 ms   (total 971 ms)
 *     paint canvas willRead…    → getImageData  0.109 ms   (total  62 ms)
 *                                              ────────    ──────────────
 *                                                  20.8x          15.7x
 *
 * The destination context already had the hint, so the readback itself was
 * cheap; what cost 2.2 ms was the `drawImage` FROM an accelerated canvas, whose
 * GPU→CPU transfer `getImageData` then blocked on. The time landed on the
 * getImageData line, which is why every previous read of this code — including
 * the docblock right below, and a whole session spent on the palette snap —
 * concluded the palette maths was the expense. It never was.
 *
 * Painting gets faster too (0.074 ms → 0.028 ms per frame): these are 128px
 * boxes full of small fills, which is a shape the software rasteriser wins.
 */
function crushableContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", { willReadFrequently: true });
}

let _crushCanvas: HTMLCanvasElement | null = null;
let _crushCtx: CanvasRenderingContext2D | null = null;

/**
 * Crush into the SHARED canvas and return it.
 *
 * The result is valid only until the next call. Callers that keep it (a texture
 * source, a cache) must use `crushToGrid` instead.
 *
 * `willReadFrequently: true` is the other half of the win: this context is
 * `getImageData`'d on every single call, which on a GPU-backed canvas forces a
 * readback each time. Measured together, reuse + the hint cut the crush loop by
 * 46% (LOAD_PLAN.md §4) — far more than the palette snap everyone reaches for.
 *
 * ── AND THEN THE OTHER 15x ──
 * That 46% was the DESTINATION half only. The hint was missing from the paint
 * canvas this reads FROM, so `drawImage` was still pulling every frame back off
 * the GPU and `getImageData` was blocking on the transfer. Putting the hint on
 * both ends took the readback from 2.271 ms to 0.109 ms. See crushableContext.
 */
function crushToGridShared(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = SPRITE_PIXEL_GRID;
  if (!_crushCanvas || _crushCanvas.width !== g) {
    _crushCanvas = document.createElement("canvas");
    _crushCanvas.width = g;
    _crushCanvas.height = g;
    _crushCtx = crushableContext(_crushCanvas);
  }
  const sctx = _crushCtx!;
  // The previous frame's pixels are still there and the incoming art has a
  // transparent surround — without this every sprite inherits the last one's
  // silhouette as a halo.
  sctx.clearRect(0, 0, g, g);
  crushInto(sctx, src, g);
  return _crushCanvas;
}

export function crushToGrid(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = SPRITE_PIXEL_GRID;
  const small = document.createElement("canvas");
  small.width = g;
  small.height = g;
  const sctx = crushableContext(small)!;
  crushInto(sctx, src, g);
  return small;
}

/** The crush itself — downscale, hard alpha cutout, dither, palette snap. */
function crushInto(sctx: CanvasRenderingContext2D, src: HTMLCanvasElement, g: number): void {
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, 0, 0, g, g);
  const im = sctx.getImageData(0, 0, g, g);
  const d = im.data;
  // Hoisted out of the per-pixel loop below: this runs for every texel of every
  // frame of every atlas.
  const PAL_RGB = palRgb();
  const LUT = snapLut();
  for (let py = 0; py < g; py++) {
    for (let px = 0; px < g; px++) {
      const i = (py * g + px) * 4;
      // A HARD alpha edge (crisp silhouette, not a soft anti-aliased fringe) is
      // half the "authored pixel art" read — raise the cutout so the outline
      // lands on whole pixels instead of a smeared halo.
      if (d[i + 3] < 128) {
        d[i + 3] = 0;
        continue;
      }
      // Ordered-dither bias for this pixel position, applied before the snap so
      // ramps stipple between two palette steps instead of banding/smearing.
      const bias = BAYER4[py & 3][px & 3] * DITHER_AMP;
      // Clamp BEFORE the table lookup: the dither bias can push a channel past
      // either end, and an out-of-range index would silently read 0 (void
      // black) — a bug that renders.
      const cr = d[i] + bias < 0 ? 0 : d[i] + bias > 255 ? 255 : d[i] + bias;
      const cg = d[i + 1] + bias < 0 ? 0 : d[i + 1] + bias > 255 ? 255 : d[i + 1] + bias;
      const cb = d[i + 2] + bias < 0 ? 0 : d[i + 2] + bias > 255 ? 255 : d[i + 2] + bias;
      let best = LUT[
        (((cr / LUT_STEP) | 0) << (LUT_BITS * 2)) | (((cg / LUT_STEP) | 0) << LUT_BITS) | ((cb / LUT_STEP) | 0)
      ];
      if (best === LUT_SCAN) {
        // This cell straddles a Voronoi boundary — the table cannot prove an
        // answer for it, so pay for the exact one.
        let bestDist = Infinity;
        best = 0;
        for (let p = 0; p < PAL_RGB.length; p++) {
          const dr = (cr - PAL_RGB[p][0]) * 0.3;
          const dg = (cg - PAL_RGB[p][1]) * 0.59;
          const db = (cb - PAL_RGB[p][2]) * 0.11;
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            best = p;
          }
        }
      }
      d[i] = PAL_RGB[best][0];
      d[i + 1] = PAL_RGB[best][1];
      d[i + 2] = PAL_RGB[best][2];
      d[i + 3] = 255;
    }
  }
  sctx.putImageData(im, 0, 0);
}

/**
 * Rasterize a single FramePaint to a pixel-art data-URL — the SAME palette-crush
 * the in-world sprites get (crushToGrid: SPRITE_PIXEL_GRID snap + Bayer dither
 * + nearest upscale). Used for DOM icons (the Tavern's buy-menu) so a shop item
 * shows the game's actual pixel art instead of an emoji. Cache the result — the
 * crush is not free.
 */
export function renderPaintIcon(paint: FramePaint): string {
  const crushed = renderPaintCanvas(paint);
  return crushed ? crushed.toDataURL() : "";
}

/**
 * The same rasterisation, stopping at the CANVAS.
 *
 * The in-game UI draws icons with `drawImage` straight onto its layer, so
 * encoding a PNG and decoding it back through an `Image` — which is what
 * `renderPaintIcon` exists to produce for DOM `<img>` — would be pure waste,
 * and worse, ASYNCHRONOUS: an immediate-mode UI paints and returns in one pass,
 * so an icon that is not ready *now* is an icon that is missing this frame.
 * Handing back the canvas keeps the whole path synchronous.
 */
export function renderPaintCanvas(paint: FramePaint): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = crushableContext(canvas); // a crush source — see crushableContext
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  paint(ctx);
  // Ship the crushed canvas AT ITS NATIVE SIZE.
  //
  // This used to upscale ×3 to 216px on the reasoning that 72px "would be tiny
  // in the shop DOM". That was simply wrong: `tavern.ts` draws these icons at
  // 28-34px, so 72px is already more than double the box. The upscale turned a
  // 2.4× minification into a 7.2× one, and because `.tv-icon` sets
  // `image-rendering: pixelated`, the browser nearest-samples 1 pixel in every
  // 7.2 — so a 2px highlight survives or vanishes depending on its sub-pixel
  // phase, differently per item. It also cost 2.8× the pixels through a
  // synchronous PNG encode for every shop entry.
  return crushToGrid(canvas);
}

/**
 * The paint scratch, reused across every frame of every atlas.
 *
 * Same reasoning as the crush canvas above, and the same measurement: this used
 * to be a fresh 128×128 canvas (plus its own 2D context) PER FRAME, so one
 * `/dungeon` load allocated 1,828 canvases between here and `crushToGrid`.
 * Nothing retains it — `paintFrame` blits and moves on — so one is enough.
 */
let _paintCanvas: HTMLCanvasElement | null = null;
let _paintCtx: CanvasRenderingContext2D | null = null;

/** Paint one frame on a scratch canvas and blit it into the strip at `index`. */
function paintFrame(strip: CanvasRenderingContext2D, paint: FramePaint, col: number, row: number): void {
  if (!_paintCanvas) {
    _paintCanvas = document.createElement("canvas");
    _paintCanvas.width = SPRITE_PX;
    _paintCanvas.height = SPRITE_PX;
    // A CRUSH SOURCE — see crushableContext. This one canvas paints all ~830
    // atlas frames of a load, so the hint is worth more here than anywhere else
    // in the file.
    _paintCtx = crushableContext(_paintCanvas);
    if (!_paintCtx) throw new Error("[dungeon] could not get 2D context for sprite frame");
  }
  const ctx = _paintCtx!;
  // Non-negotiable on a reused canvas: painters draw a character on a
  // transparent field and do not clear first, so without this every frame is
  // composited on top of the previous one.
  ctx.clearRect(0, 0, SPRITE_PX, SPRITE_PX);
  // Painters mutate transform/alpha/composite freely. save/restore keeps one
  // frame's leftover state from bleeding into the next now that they share a
  // context — with a fresh canvas per frame this was free.
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  paint(ctx);
  ctx.restore();
  // The strip cell is the GRID, not the paint box — the crushed art goes in at
  // its native size and is never scaled again between here and the screen.
  // Shared crush target: blitted on this line, never retained. See the warning
  // on crushToGridShared.
  strip.drawImage(crushToGridShared(_paintCanvas), col * SPRITE_PIXEL_GRID, row * SPRITE_PIXEL_GRID);
}

/**
 * An atlas being painted a slice at a time.
 *
 * WHY THIS EXISTS. Painting an atlas is ~100 frames of vector art, each crushed
 * to the palette; even after the readback fix (see crushableContext) that is
 * tens of milliseconds in ONE synchronous call, and every caller that reached
 * for it did so from somewhere the player was watching — the rAF loop, or an
 * idle callback whose advisory deadline it blew straight through. Profiled over
 * a 30s bot run, atlas painting owned 60% of all hitch time.
 *
 * The sheet handle is valid the moment the build starts; unpainted cells are
 * transparent. That is safe ONLY because nothing renders a sheet before its
 * owner hands it out, and every hand-out path calls `finish()` first. Keep that
 * invariant — a half-painted atlas on screen is an invisible monster.
 */
export interface SheetBuild {
  /** Usable immediately. Cells not yet painted are transparent. */
  readonly sheet: SpriteSheet;
  readonly done: boolean;
  /** Paint frames until `budgetMs` is spent. Returns true when finished. */
  step(budgetMs: number): boolean;
  /** Paint everything that is left, right now. */
  finish(): SpriteSheet;
}

/**
 * Build one atlas for an actor. Frames are packed in a stable order and the
 * clip table records where each one landed. Every painter set with the same
 * clip structure produces the SAME layout — which is what lets a weapon swap
 * replace the texture without touching the animator.
 */
export function buildSpriteSheet(paints: ActorPaints): SpriteSheet {
  return startSpriteSheet(paints).finish();
}

/** The same atlas, painted incrementally. See {@link SheetBuild}. */
export function startSpriteSheet(paints: ActorPaints): SheetBuild {
  const flat: FramePaint[] = [];
  const clips = new Map<string, number[]>();
  /** FramePaint → its slot in `flat`, so identical frames pack once. */
  const seen = new Map<FramePaint, number>();

  const dirs: Dir[] = ["S", "N", "E"];
  // Every clip an actor might author. `roll` is knight-only; actors that don't
  // define a clip are skipped (the `if (!list) continue` below), so listing
  // them all here is harmless and keeps new clips from silently vanishing.
  const clipNames: ClipName[] = [
    "idle", "walk", "run", "attack", "death", "roll", "ball", "steelball",
    // The six MARBLE BODIES. Cheap despite the count: each is authored once and
    // handed to all three facings by reference, so the dedupe below packs 4
    // frames per material rather than 12.
    "diamondball", "waterball", "stoneball", "stormball", "shadowball", "lavaball",
    // The ricochet forms (bolt / laser) — same one-off authoring, same sharing.
    "boltform", "laserform",
    "equip", "forge", "crouch", "wait", "wake", "stumble",
  ];

  for (const dir of dirs) {
    for (const clip of clipNames) {
      const list = paints[dir][clip];
      if (!list) continue;
      // DEDUPE by reference: a clip that is identical across facings (the steel
      // ball is a sphere — it looks the same from every angle) hands the SAME
      // FramePaint objects to each direction, and packing those three times
      // wastes atlas width for no visual difference. The strip is one row, so
      // width is the scarce resource that decides whether the sheet fits.
      const indices: number[] = [];
      for (const paint of list) {
        let at = seen.get(paint);
        if (at === undefined) {
          at = flat.length;
          seen.set(paint, at);
          flat.push(paint);
        }
        indices.push(at);
      }
      clips.set(`${dir}:${clip}`, indices);
    }
  }

  // GRID, not a strip. A single row of frames hit the GPU's 8192px texture
  // ceiling at 113 frames; past that the texture is silently RESIZED, which
  // corrupts every UV on the sheet and renders as a BLACK SCREEN with a working
  // HUD. Nothing throws, so it costs a deploy to find. Wrapping into rows means
  // width is bounded by COLS and the sheet grows downward instead.
  const cols = Math.min(flat.length, Math.floor(MAX_ATLAS_WIDTH / SPRITE_PIXEL_GRID));
  const rows = Math.max(1, Math.ceil(flat.length / cols));

  const canvas = document.createElement("canvas");
  canvas.width = cols * SPRITE_PIXEL_GRID;
  canvas.height = rows * SPRITE_PIXEL_GRID;
  if (canvas.height > MAX_ATLAS_WIDTH) {
    throw new Error(
      `[dungeon] sprite atlas is ${canvas.width}x${canvas.height}px (${flat.length} frames) — over the ` +
        `${MAX_ATLAS_WIDTH}px limit in BOTH axes. Share identical frames across facings or drop a clip.`,
    );
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[dungeon] could not get 2D context for sprite atlas");

  const texture = new THREE.CanvasTexture(canvas);
  celFilters(texture);
  texture.wrapS = THREE.RepeatWrapping; // needed for the flip trick below
  texture.wrapT = THREE.RepeatWrapping; // rows now, so V wraps too
  // Show exactly one CELL at a time.
  texture.repeat.set(1 / cols, 1 / rows);

  const sheet: SpriteSheet = { texture, clips, frameCount: flat.length, cols, rows };
  let next = 0;

  const paintUntil = (limit: number): boolean => {
    const from = next;
    while (next < flat.length) {
      paintFrame(ctx, flat[next], next % cols, Math.floor(next / cols));
      next++;
      // Checked AFTER a frame, never before: a zero budget must still make
      // progress, or a caller that always passes a spent deadline would spin on
      // this build forever without ever finishing it.
      if (performance.now() >= limit) break;
    }
    // Only when something was actually painted — an unnecessary needsUpdate is a
    // full re-upload of an atlas that can be 8136x144.
    if (next > from) texture.needsUpdate = true;
    return next >= flat.length;
  };

  return {
    sheet,
    get done() {
      return next >= flat.length;
    },
    step: (budgetMs) => paintUntil(performance.now() + budgetMs),
    finish: () => {
      paintUntil(Infinity);
      return sheet;
    },
  };
}

/**
 * Build a sheet on FIRST USE and cache it for the session.
 *
 * Most actors' sheets are built up-front in core's init, but a rare actor (the
 * reaper appears at most once per floor, after a delay — most runs never see
 * one) should not pay that cost at level boot. `paints` is a thunk so the art
 * itself is not constructed until the sheet is.
 */
export function lazySheet(paints: () => ActorPaints): () => SpriteSheet {
  let cached: SpriteSheet | null = null;
  return () => {
    if (!cached) cached = buildSpriteSheet(paints());
    return cached;
  };
}

export interface ActorSprite {
  mesh: THREE.Mesh;
  sheet: SpriteSheet;
  /** Point the sprite at a frame index within the atlas. */
  setFrame(index: number): void;
  /** Flip horizontally — this is how W is rendered from the E art. */
  setFlipped(flipped: boolean): void;
  /** Multiply-tint the whole sprite (hit flash). Pass null to clear. */
  setTint(hex: number | null): void;
  /**
   * Swap to a different atlas with the SAME clip layout — this is how the
   * knight's held weapon changes. The silhouette (if any) must be re-synced
   * by the caller via its own syncMap().
   */
  setSheet(next: SpriteSheet): void;
  /**
   * Show/hide the flat contact-shadow blob. The blob's flat orientation is
   * baked against the ISO camera; the FPS rampage yaw-billboards the sprite, so
   * it hides the blob for the duration rather than let it stick up wrong.
   */
  setBlobVisible(v: boolean): void;
  /**
   * Hold the contact shadow on the GROUND while the actor is airborne.
   *
   * The blob is a CHILD of the sprite mesh, so raising `mesh.position.y` for a
   * ramp hop / wall-kick / pounce lifted the shadow with the knight — which is
   * exactly the cue that was supposed to sell the height, and it read as the
   * shadow being glued to his feet instead.
   *
   * Pass the actor's current elevation above the floor; the blob cancels it and
   * stays put. Pass 0 on landing.
   */
  setElevation(dy: number): void;
  dispose(): void;
}

export function createActorSprite(sheet: SpriteSheet, lit: boolean): ActorSprite {
  // Shared across every actor — the quad and its bottom-centre origin are
  // identical for all of them (see spriteGeometry).
  const geo = spriteGeometry();

  // The texture is cloned per-sprite so two actors sharing a sheet can be on
  // different frames — the offset lives on the texture, not the material.
  // This clone is the ONE genuinely per-actor allocation here, and it is why
  // the horde cannot simply become a single InstancedMesh without first moving
  // the frame offset into an instanced attribute.
  let tex = sheet.texture.clone();
  tex.needsUpdate = true;

  const matOpts = {
    map: tex,
    transparent: true,
    alphaTest: 0.5, // hard-edged cutout — keeps the depth-outline pass crisp
    side: THREE.DoubleSide,
  };

  const mat = lit
    ? new THREE.MeshLambertMaterial(matOpts)
    : new THREE.MeshBasicMaterial(matOpts);

  const mesh = new THREE.Mesh(geo, mat);
  faceCamera(mesh);
  mesh.renderOrder = 10;

  const blob = makeContactBlob(mesh);

  let flipped = false;
  let currentFrame = 0;

  // When repeat.x is negative the texture reads right-to-left, so the offset has
  // to anchor on the frame's RIGHT edge instead of its left. Get this wrong and
  // a flipped sprite shows the neighbouring frame.
  function applyFrame(): void {
    const { cols, rows } = api.sheet;
    const col = currentFrame % cols;
    const row = Math.floor(currentFrame / cols);
    tex.offset.x = (flipped ? col + 1 : col) / cols;
    // V is bottom-up in GL while the canvas paints top-down, so row 0 is the
    // TOP row of the image and must map to the highest offset.
    tex.offset.y = (rows - 1 - row) / rows;
  }

  const api: ActorSprite = {
    mesh,
    sheet,
    setFrame(index: number): void {
      if (index === currentFrame) return;
      currentFrame = index;
      applyFrame();
    },
    setFlipped(next: boolean): void {
      if (next === flipped) return;
      flipped = next;
      tex.repeat.x = (flipped ? -1 : 1) / api.sheet.cols;
      applyFrame(); // repeat changed — the offset anchor moved with it
    },
    // The material colour MULTIPLIES the texture, so white is "no tint". A red
    // tint darkens green/blue pixels toward red — reads as a blood flash even on
    // the rot-green zombie palette.
    setTint(hex: number | null): void {
      mat.color.setHex(hex ?? 0xffffff);
    },
    setSheet(next: SpriteSheet): void {
      if (next === api.sheet) return;
      const old = tex;
      tex = next.texture.clone();
      tex.needsUpdate = true;
      api.sheet = next;
      mat.map = tex;
      mat.needsUpdate = true;
      tex.repeat.set((flipped ? -1 : 1) / next.cols, 1 / next.rows);
      applyFrame();
      old.dispose();
    },
    setBlobVisible(v: boolean): void {
      blob.visible = v;
    },
    setElevation(dy: number): void {
      // The blob's rest position is 2cm above the feet, expressed in the
      // parent's LOCAL frame (the parent is billboarded, hence the inverse
      // rotation). Subtracting the elevation in that same frame pins the shadow
      // to the floor while the sprite rises.
      const inv = mesh.quaternion.clone().invert();
      blob.position.copy(new THREE.Vector3(0, 0.02 - dy, 0).applyQuaternion(inv));
    },
    dispose: () => {
      // ONLY what this actor uniquely owns. `geo`, the blob's geometry and the
      // blob's material are module singletons shared by every actor on the
      // floor (see spriteGeometry/blobGeometry/blobMaterial) — disposing them
      // here would tear the shared buffers out from under every OTHER living
      // actor the moment the first one died, so the horde would render blank
      // from the first kill onward. They are deliberately never disposed.
      mat.dispose();
      tex.dispose();
    },
  };

  applyFrame();
  return api;
}

/**
 * A silhouette pass for the player: an identical plane that draws ONLY where
 * the sprite is hidden by geometry (depthFunc GreaterDepth = "behind what's
 * already there"), as a flat arcane-blue cutout. Parent it to the actor's mesh
 * and you can never lose your character behind a wall — the classic
 * see-through-occluder treatment for top-down crawlers, done without a
 * stencil buffer.
 */
export function createOcclusionSilhouette(actor: ActorSprite): { mesh: THREE.Mesh; syncMap(): void; dispose(): void } {
  const geo = new THREE.PlaneGeometry(SPRITE_UNITS, SPRITE_UNITS);
  geo.translate(0, SPRITE_UNITS / 2, 0);

  const srcMat = actor.mesh.material as THREE.MeshBasicMaterial;
  const mat = new THREE.MeshBasicMaterial({
    map: srcMat.map, // SHARED texture — follows the actor's frame/flip for free
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    // The game's designated occlusion tint — reads as "you, behind the wall".
    color: enginePalette.hex()[enginePalette.occlusionIndex],
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth, // only draw where something occludes us
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20; // after the world and the normal sprite pass
  // Parented to the actor mesh, so no rotation/position of its own is needed.
  actor.mesh.add(mesh);

  return {
    mesh,
    /** Re-grab the actor's texture after a setSheet() weapon swap. */
    syncMap: () => {
      mat.map = (actor.mesh.material as THREE.MeshBasicMaterial).map;
      mat.needsUpdate = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose(); // the map is the actor's — the actor disposes it
    },
  };
}

/**
 * A single-frame ground sprite (weapon and gear pickups, props). Same
 * billboarding contract as actors: origin at the bottom-centre, tilted once
 * toward the fixed camera.
 */
/**
 * Texture cache for static sprites, keyed by the PAINTER.
 *
 * Every item of a kind is byte-identical — `ITEM_PAINTS.coin` always draws the
 * same coin — so building it per instance was pure waste. Coins made that waste
 * expensive: a kill drops 2-4 of them (a style kill up to 8, a pinball
 * multi-kill 20+ in a frame), and each one was a 128px canvas + the vector
 * paint + `crushToGrid`, whose palette snap alone is 72×72 pixels × 32 palette
 * entries ≈ 166k distance evaluations. Twenty coins in one frame was ~3.3M
 * iterations plus 40 canvas allocations and 20 GPU uploads, all synchronous, at
 * exactly the moment the screen is busiest.
 *
 * The live-coin cap does NOT help — it culls after `spawnCoin` has already
 * built every sprite, so it bounds draw calls and memory, never the spawn cost.
 *
 * Session-lifetime, like `sharedBlobTexture` above: `ITEM_PAINTS` is a fixed
 * finite set, so there is nothing to evict. A WeakMap keyed on the closure
 * still lets a one-off painter be collected if a caller ever passes one.
 */
const staticTexCache = new WeakMap<FramePaint, THREE.CanvasTexture>();

function staticTexture(paint: FramePaint): THREE.CanvasTexture {
  const hit = staticTexCache.get(paint);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = crushableContext(canvas); // a crush source — see crushableContext
  if (!ctx) throw new Error("[dungeon] could not get 2D context for item sprite");
  ctx.imageSmoothingEnabled = true;
  paint(ctx);

  // Upload the CRUSHED canvas, not the 128px paint box — one texel per render
  // pixel at zoom 1, same rule as the actor atlas. NB the tavern runs a camera
  // zoom below 1, so items there are minified and this does NOT hold; see the
  // note on SPRITE_UNITS in constants.ts.
  const tex = new THREE.CanvasTexture(crushToGrid(canvas));
  celFilters(tex);
  staticTexCache.set(paint, tex);
  return tex;
}

/**
 * Shared geometry for every static sprite — they are all the same quad.
 * Built lazily so importing this module never touches THREE's GL side.
 */
let sharedStaticGeo: THREE.PlaneGeometry | null = null;
function staticGeometry(): THREE.PlaneGeometry {
  if (!sharedStaticGeo) {
    sharedStaticGeo = new THREE.PlaneGeometry(SPRITE_UNITS, SPRITE_UNITS);
    sharedStaticGeo.translate(0, SPRITE_UNITS / 2, 0);
  }
  return sharedStaticGeo;
}

export function createStaticSprite(paint: FramePaint): { mesh: THREE.Mesh; dispose(): void } {
  // The MATERIAL stays per-instance: `tavern/npcs.ts` tints individual keepers
  // via `mesh.material.color`, so sharing it would tint the whole cast.
  const mat = new THREE.MeshBasicMaterial({
    map: staticTexture(paint),
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(staticGeometry(), mat);
  faceCamera(mesh);
  mesh.renderOrder = 5; // under actors, over the floor

  return {
    mesh,
    // Only the material is ours. The geometry and texture are shared and
    // outlive every individual sprite — disposing them here would blank every
    // other item on the floor.
    dispose: () => mat.dispose(),
  };
}
