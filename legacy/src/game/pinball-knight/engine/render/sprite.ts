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
const { px: SPRITE_PX, artPx: ART_PX, units: SPRITE_UNITS, pixelGrid: SPRITE_PIXEL_GRID, maxAtlasWidth: MAX_ATLAS_WIDTH } =
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
 * ── WHY THERE IS NO DITHER HERE ANY MORE (2026-07-29) ───────────────────────
 *
 * A 4×4 ordered (Bayer) dither used to bias each pixel BEFORE the palette snap,
 * on the standard argument that it breaks a smooth ramp into a stippled checker
 * between two palette steps instead of a hard band. Amplitude had already been
 * walked down 26 → 10 because it "reads as noise on a small animated character".
 *
 * It is gone entirely now, because the argument does not hold for THIS palette.
 * Ordered dither assumes the two entries either side of a value are adjacent
 * TONES. Cold Crypt's 32 colours are not a tone ramp — they are eight short
 * ramps in different hue families, and the snap is luma-weighted (0.3/0.59/0.11),
 * so green dominates the distance. Adding the SAME bias to r, g and b moves a
 * colour along the grey diagonal, and the nearest entry to the biased value is
 * routinely in a different FAMILY: steel plate picks up rot-green, bone picks up
 * arcane cyan. That is not a stipple, it is chroma confetti — and it is exactly
 * the "confetti on the plate" artifact figure.ts's ramp comment describes,
 * arriving from the dither instead of from computed tints.
 *
 * Side by side over the knight, jester, spider and slime at the shipping grid,
 * amplitude 0 was cleaner than 6, which was cleaner than 10, at every one.
 * Tone blending now comes from the material RAMPS the painters already declare,
 * which land on real palette entries and quantize with no noise at all.
 *
 * If a large smooth surface ever genuinely needs blending, the fix is a dither
 * that steps along ONE ramp (bias toward the neighbouring index in the same
 * family), not a uniform RGB nudge.
 */

/**
 * Unsharp-mask amount applied at the SHIPPING grid, after the downscale.
 *
 * The downscale is the blur: 128/72 is 1.78, so every internal boundary lands
 * across two output pixels as a gradient, and the painters' 3.2px selout ink
 * averages into the fill it was supposed to separate. The result reads as a
 * soft airbrushed figure however carefully the cel was authored — the ink is
 * still THERE, it is just spread too thin to survive the snap.
 *
 * A local contrast pass at 72px puts it back: each pixel is pushed away from
 * the mean of its four neighbours, which re-darkens the outline and re-brightens
 * the fill either side of it, so the snap lands them on DIFFERENT palette
 * entries instead of the same one. 1.3 is where the outline returns without the
 * bright fills clipping into a halo.
 */
/**
 * ⚠️ STILL 1.3, BUT NOT FOR THE REASON WRITTEN ABOVE. See the measurement table
 * on `CRUSH_DEFAULTS`: this pass is a net colour GENERATOR, and the only thing
 * currently holding it in place is that the stiltneck's gold read depends on it.
 */
const SHARPEN_AMOUNT = 1.3;


/**
 * How far a shadow-side silhouette pixel is pulled toward the outline colour.
 *
 * The definition half of the Ragnarok-ish read is a hard dark edge, and after
 * the crush the sprite has none — the outermost kept pixel is whatever the
 * downscale averaged. Three variants were rendered side by side:
 *
 *   · replace the edge pixel with ink → eats thin features. A spider leg is one
 *     pixel wide at this grid, so every pixel of it is an edge pixel and the leg
 *     becomes a black line.
 *   · add ink OUTSIDE the silhouette → fattens everything and grows the sprite.
 *   · darken only the DOWN/RIGHT rim, partially → this.
 *
 * Directional is the one that is actually principled rather than merely the
 * least bad: `figure.ts` lights every part from a FIXED upper-left key, so the
 * up/left rim is the lit edge and darkening it would be painting shadow onto the
 * light source. Restricting the pass to the shadow side gives thin features an
 * edge on one side and leaves their highlight on the other, which is what makes
 * them read as lit rather than as outlined.
 */
const SELOUT_SHADOW = 0.6;
/**
 * ⚠️ THE PREMISE OF THE DOCSTRING ABOVE IS DEAD. It reasons from "128/72 is
 * 1.78, so every internal boundary lands across two output pixels as a
 * gradient". That downscale no longer exists: `SPRITE_PX = PPU*9/4` and
 * `SPRITE_PIXEL_GRID = PPU*9/8`, so the ratio is EXACTLY 2 at every camera rung
 * and the filter is an exact 2x2 box. The pass may still be earning its keep —
 * `INK_W` is 3.2 art units, i.e. 1.57 texels at the shipped rung, so the ink
 * still straddles — but it is no longer justified by the reason written down.
 *
 * The form is the part that is not defensible. The loop below sharpens EACH
 * CHANNEL INDEPENDENTLY and unbounded, then hands the result to a LUMA-WEIGHTED
 * snap. That moves a colour off the grey diagonal by an amount that depends on
 * how far each channel individually sits from its neighbourhood mean, and the
 * snap then follows the exaggerated chroma to whichever family is nearest. It is
 * a stronger version of exactly the failure the dither postmortem documents a
 * few lines below: "the nearest entry to the biased value is routinely in a
 * different FAMILY — that is not a stipple, it is chroma confetti".
 *
 * `sharpenLuma` is the third arm. It computes the unsharp on luma alone and
 * scales all three channels by `L'/L`, which keeps the edge contrast but CANNOT
 * change hue family: a scaled RGB triple moves along a ray from the origin, and
 * this palette's eight families are separated by hue, not by brightness.
 */
export interface CrushOptions {
  /** Unsharp amount at the grid. 0 makes the pass a copy. */
  sharpen: number;
  /** Sharpen luma only (scale RGB by one factor) instead of per-channel. */
  sharpenLuma: boolean;
  /** Shadow-rim blend toward ink. 0 skips the pass and its scratch copy. */
  selout: number;
}

/**
 * MEASURED 2026-07-29, and the answer was not the expected one.
 *
 * Five arms over the whole 20-actor roster at the shipped rung (63), through the
 * real `paintInArtSpace` → `crushToGrid` path. `invented` = palette indices in
 * the atlas the painter never asked for, measured against the pre-crush buffer.
 *
 *   arm                        entries  isolated%  runLen  invented  INK SHARE
 *   A  per-channel 1.3 (was)     22.9      26.2     1.73     295      21.82%
 *   B  sharpen OFF               20.1      22.5     1.82     238      22.84%
 *   C  per-channel 0.65          21.8      23.8     1.80     271      23.38%
 *   D  luma-only 1.3             21.9      26.4     1.73     276      21.75%
 *
 * ⚠️ THE FALSIFIER FIRED BACKWARDS. This pass exists to stop the 3.2-unit selout
 * ink averaging into the fill it separates, so removing it had to COST ink or the
 * stated rationale was wrong. Removing it GAINS ink: 21.82% → 22.84%. The pass
 * was not protecting the outline, it was eating it — brightening the fill texels
 * either side of the ink until the blended rim snapped off index 1 onto something
 * lighter. Every noise metric agrees, and a nearest-upscaled contact sheet across
 * eight monsters shows the speckle gone from the stiltneck's coat and the
 * rotortail's pelt with no loss of silhouette (the hard alpha cutout and the
 * selout do that work, not this).
 *
 * Two predictions this killed, recorded so they are not re-proposed:
 *   · "amplitude is not the mechanism, per-channel is" — false. C sits neatly
 *     between A and B on every metric; the effect is monotonic in amount.
 *   · "luma-only keeps the edge without inventing hues" — false. D is within
 *     noise of A (26.4 vs 26.2 isolated). The mechanism is local-contrast
 *     amplification itself, not chroma drift, so restricting the direction of
 *     the push changes nothing. `sharpenLuma` is kept only as a measurement arm.
 *
 * The original docstring's premise was already dead — it reasons from a 1.78
 * fractional downscale, and the ratio has been exactly 2 since the SPRITE_PX
 * split.
 *
 * ⚠️ IT TOOK AN ART FIX TO LAND. Arm B first failed the stiltneck's warmth
 * guard, because that creature did not reach gold on its own art — it reached
 * gold because this pass brightened borderline blends UP into the torch ramp
 * (14-18) instead of letting them settle on leather (26-28), worth about +0.06
 * on its neck band. Removing the pass re-opened the "brown giraffe" b4409e4
 * fixed. Sweeping the amount, BEFORE the art fix:
 *
 *   sharpen   neck torch (then gated > 0.25)   torch vs leather
 *   0.0            0.211  FAIL                  0.229 vs 0.270  FAIL
 *   0.65           0.246  FAIL                  pass
 *   0.9            0.250  FAIL (exactly on)     pass
 *   1.3            pass                         pass
 *
 * A downstream asset had come to depend on an upstream defect. So the stiltneck
 * was fixed IN THE ART — markings moved onto the coat's own dark rung, the horn
 * knob off the timber ramp, and the neck's ink skirt thinned from 1.5 texels a
 * side to one — which took it to torch 0.266 vs leather 0.251 above the pool
 * with the sharpen off, and the guard was rewritten to compare neck against
 * SHINS (scale-free) rather than against an absolute share the sharpen had been
 * propping up. Only then did this go to 0.
 *
 * Do not restore it without re-running the bench: `CRUSH_AB=1`.
 */
const CRUSH_DEFAULTS: CrushOptions = {
  sharpen: 0,
  sharpenLuma: false,
  selout: SELOUT_SHADOW,
};

let CRUSH: CrushOptions = { ...CRUSH_DEFAULTS };

/**
 * Run `fn` with crush variants applied, then restore. TESTS AND `scripts/` ONLY.
 *
 * This is a measurement seam, not a setting. The alternative — threading an
 * options argument — would have to cross five signatures (`startSpriteSheet` →
 * `paintFrame` → `crushToGridShared` → `crushInto` → `snapColor`) to run an
 * experiment, and would leave all five permanently documenting a variant nobody
 * ships. A scoped try/finally has no persistent state for a settings screen to
 * bind to, which is most of the enforcement; `registry-drift.mjs` is the rest.
 *
 * HARD LINE: this carries variants UNDER MEASUREMENT, never shipped non-default.
 * Per-sheet production data (a palette lock) belongs on the sheet build options,
 * so this seam can never quietly become the transport for real content.
 */
export function withCrushOptions<T>(over: Partial<CrushOptions>, fn: () => T): T {
  const prev = CRUSH;
  CRUSH = { ...prev, ...over };
  try {
    return fn();
  } finally {
    CRUSH = prev;
  }
}

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
 */
/**
 * A 2D context for a canvas that will be CRUSHED — i.e. one whose pixels
 * `crushInto` is about to read back with `getImageData`.
 *
 * ⚠️ THE HINT BELONGS ON THE SOURCE. That is the opposite of the intuition (a
 * paint box is only ever *written*), and it is where the time was.
 *
 * MEASURED (host Chrome, RTX 3090 Ti, 400 crushes of a 128px paint box down to
 * the 72px grid, timing the readback alone):
 *
 *     source canvas GPU-backed          getImageData  2.271 ms   (total 971 ms)
 *     source canvas willReadFrequently  getImageData  0.109 ms   (total  62 ms)
 *                                                    ────────    ──────────────
 *                                                        20.8x          15.7x
 *
 * Without the hint the source lives in GPU memory, so reading it is a
 * synchronous GPU→CPU transfer — and the whole cost lands on the getImageData
 * line, which is why reading this code has repeatedly concluded the palette
 * maths was the expense. It never was. `_paintCanvas` already carries the hint;
 * the other two crush sources in this file are `renderPaintCanvas` and
 * `staticTexture`, and they go through here so the rule has one home.
 *
 * Painting gets faster too (0.074 ms → 0.028 ms per frame): these are 128px
 * boxes full of small fills, a shape the software rasteriser wins.
 */
function crushableContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", { willReadFrequently: true });
}

function crushToGridShared(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = SPRITE_PIXEL_GRID;
  if (!_crushCanvas || _crushCanvas.width !== g) {
    _crushCanvas = document.createElement("canvas");
    _crushCanvas.width = g;
    _crushCanvas.height = g;
    _crushCtx = _crushCanvas.getContext("2d", { willReadFrequently: true });
  }
  const sctx = _crushCtx!;
  // The previous frame's pixels are still there and the incoming art has a
  // transparent surround — without this every sprite inherits the last one's
  // silhouette as a halo.
  sctx.clearRect(0, 0, g, g);
  crushInto(sctx, src, g);
  return _crushCanvas;
}

/**
 * Crush to a caller-owned canvas.
 *
 * `grid` OVERRIDES THE OUTPUT RESOLUTION, FOR TESTS ONLY. It exists because
 * `SPRITE_PIXEL_GRID` is a PLAYER SETTING — five camera rungs, 90/81/72/63/54,
 * derived from `CAMERA_ZOOMS` and captured at MODULE LOAD (constants/render.ts
 * documents at length why it cannot be live). Two consequences:
 *
 *   · `configureEngine` CANNOT pin it. This module destructures
 *     `engineConfig.sprite` into consts at import and never re-derives, unlike
 *     `camera.ts` which registers an `onConfigChange`. Configuring after import
 *     changes nothing here, silently.
 *   · A census that asserts on the ambient value turns itself OFF for anyone who
 *     picked a different camera — the same trap `atlas-size.test.ts` calls out.
 *     Art thresholds are pixel SHARES, and a share moves with the crush ratio.
 *
 * So the seam is a defaulted parameter: production still takes the module-load
 * capture, and a test can run the REAL filter at any rung. `axisTaps` already
 * caches per `${src}:${dst}`, so extra rungs cost one tap table each.
 */
export function crushToGrid(src: HTMLCanvasElement, grid: number = SPRITE_PIXEL_GRID): HTMLCanvasElement {
  const g = grid;
  const small = document.createElement("canvas");
  small.width = g;
  small.height = g;
  const sctx = small.getContext("2d", { willReadFrequently: true })!;
  crushInto(sctx, src, g);
  return small;
}

/**
 * SEPARABLE AREA-AVERAGE DOWNSCALE, PREMULTIPLIED.
 *
 * This replaced `drawImage(src, 0, 0, g, g)` with `imageSmoothingQuality:
 * "high"`, for two reasons.
 *
 * 1. **Edge darkening.** The canvas downscale mixes RGB across a boundary
 *    between an opaque pixel and the transparent surround. The surround's RGB
 *    is undefined (in practice 0), so every silhouette pixel is pulled toward
 *    black and the figure comes out with a dark fringe and a duller fill.
 *    Weighting by alpha and dividing it back out is the correct filter, and it
 *    is visibly brighter and cleaner across the whole roster.
 * 2. **It is the host's filter, not ours.** `"high"` is a hint; Skia, Cairo and
 *    Gecko each pick their own kernel, so the shipped art depended on which
 *    engine baked the atlas. A box filter is the same picture everywhere.
 *
 * Cost was the objection — boot time is a tracked concern here and this is a JS
 * loop where there was a native call. It is separable (one horizontal pass, one
 * vertical) and 128/72 reduces to 16/9, so the tap weights repeat every 9 output
 * pixels and are computed ONCE per size. Measured over 830 frames — one
 * `/dungeon` load's worth — the whole current crush is 354 ms and this filter is
 * 143 ms of replacement, not addition.
 */
interface AxisTaps { starts: Int32Array; counts: Int32Array; offs: Int32Array; ws: Float64Array }
const _tapCache = new Map<string, AxisTaps>();
function axisTaps(src: number, dst: number): AxisTaps {
  const key = `${src}:${dst}`;
  const hit = _tapCache.get(key);
  if (hit) return hit;
  const k = src / dst;
  const starts = new Int32Array(dst);
  const counts = new Int32Array(dst);
  const offs = new Int32Array(dst);
  const ws: number[] = [];
  for (let o = 0; o < dst; o++) {
    const a = o * k;
    const b = (o + 1) * k;
    starts[o] = Math.floor(a);
    offs[o] = ws.length;
    let n = 0;
    for (let i = Math.floor(a); i < Math.ceil(b); i++) {
      ws.push((Math.min(b, i + 1) - Math.max(a, i)) / k);
      n++;
    }
    counts[o] = n;
  }
  const taps: AxisTaps = { starts, counts, offs, ws: Float64Array.from(ws) };
  _tapCache.set(key, taps);
  return taps;
}

/** Scratch buffers for the crush. Reused — see the canvas-reuse note above; the
 *  same 1,828-allocations-per-load argument applies to these. */
let _rowBuf: Float64Array | null = null;
let _pixBuf: Float64Array | null = null;

/**
 * Nearest palette index for one colour, under the luma-weighted metric.
 *
 * Exported ONLY so `render/snap-lut.test.ts` can assert the table against the
 * scan directly. That test used to prove the claim by restating the entire
 * surrounding crush pipeline and diffing whole frames — which meant a change to
 * the DOWNSCALE broke a test about the LOOKUP TABLE, and the mirror had to be
 * hand-maintained in lockstep forever. Same hand-mirror trap as the `ALL_KEYS`
 * roster in boot/lazy-sheets.test.ts. Testing this function directly is both a
 * stronger guarantee (a dense sweep of the colour cube, not whatever colours a
 * few frames happened to contain) and one that cannot rot.
 */
export function snapColor(r: number, g: number, b: number): number {
  const PAL_RGB = palRgb();
  const best = snapLut()[
    (((r / LUT_STEP) | 0) << (LUT_BITS * 2)) | (((g / LUT_STEP) | 0) << LUT_BITS) | ((b / LUT_STEP) | 0)
  ];
  if (best !== LUT_SCAN) return best;
  // This cell straddles a Voronoi boundary — the table cannot prove an answer
  // for it, so pay for the exact one.
  let bestDist = Infinity;
  let out = 0;
  for (let p = 0; p < PAL_RGB.length; p++) {
    const dr = (r - PAL_RGB[p][0]) * 0.3;
    const dg = (g - PAL_RGB[p][1]) * 0.59;
    const db = (b - PAL_RGB[p][2]) * 0.11;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; out = p; }
  }
  return out;
}

/** The crush itself — downscale, hard alpha cutout, sharpen, selout, snap. */
function crushInto(sctx: CanvasRenderingContext2D, src: HTMLCanvasElement, g: number): void {
  const sw = src.width;
  const sh = src.height;
  const sctx2 = src.getContext("2d");
  if (!sctx2) throw new Error("[dungeon] crush source has no 2D context");
  const sd = sctx2.getImageData(0, 0, sw, sh).data;

  const tx = axisTaps(sw, g);
  const ty = axisTaps(sh, g);
  if (!_rowBuf || _rowBuf.length < g * sh * 4) _rowBuf = new Float64Array(g * sh * 4);
  if (!_pixBuf || _pixBuf.length < g * g * 4) _pixBuf = new Float64Array(g * g * 4);
  const row = _rowBuf;
  const pix = _pixBuf;

  // ── horizontal pass: sw×sh → g×sh, RGB weighted by alpha ──
  for (let y = 0; y < sh; y++) {
    const ro = y * sw * 4;
    const to = y * g * 4;
    for (let x = 0; x < g; x++) {
      const st = tx.starts[x];
      const n = tx.counts[x];
      const wo = tx.offs[x];
      let r = 0, gg = 0, b = 0, a = 0;
      for (let t = 0; t < n; t++) {
        const i = ro + (st + t) * 4;
        const al = sd[i + 3] * tx.ws[wo + t];
        r += sd[i] * al;
        gg += sd[i + 1] * al;
        b += sd[i + 2] * al;
        a += al;
      }
      const o = to + x * 4;
      row[o] = r; row[o + 1] = gg; row[o + 2] = b; row[o + 3] = a;
    }
  }
  // ── vertical pass: g×sh → g×g, then un-premultiply ──
  for (let y = 0; y < g; y++) {
    const st = ty.starts[y];
    const n = ty.counts[y];
    const wo = ty.offs[y];
    for (let x = 0; x < g; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let t = 0; t < n; t++) {
        const i = ((st + t) * g + x) * 4;
        const w = ty.ws[wo + t];
        r += row[i] * w; gg += row[i + 1] * w; b += row[i + 2] * w; a += row[i + 3] * w;
      }
      const o = (y * g + x) * 4;
      pix[o] = a > 0 ? r / a : 0;
      pix[o + 1] = a > 0 ? gg / a : 0;
      pix[o + 2] = a > 0 ? b / a : 0;
      // Alpha stays in 0-255: `keep` below tests it against the 128 cutout, and
      // normalising here made every pixel transparent — a crush that produced
      // an entirely blank atlas, which is why this pipeline gets rendered and
      // looked at rather than reasoned about.
      pix[o + 3] = a;
    }
  }

  const im = sctx.createImageData(g, g);
  const d = im.data;
  const PAL_RGB = palRgb();

  // A HARD alpha edge (crisp silhouette, not a soft anti-aliased fringe) is
  // half the "authored pixel art" read — the cutout lands the outline on whole
  // pixels instead of a smeared halo. Kept as a separate array because the
  // sharpen and selout passes below both need to know the silhouette.
  const keep = new Uint8Array(g * g);
  for (let i = 0; i < g * g; i++) keep[i] = pix[i * 4 + 3] >= 128 ? 1 : 0;

  // ── SHARPEN (OFF by default — see the table on CRUSH_DEFAULTS) ──
  // Alpha-aware: a transparent neighbour contributes the CENTRE value, so the
  // silhouette rim is sharpened against the figure rather than against the void
  // — otherwise every edge pixel blows out into a bright halo.
  const at = (x: number, y: number, ch: number, cx: number, cy: number): number =>
    x < 0 || y < 0 || x >= g || y >= g || !keep[y * g + x] ? pix[(cy * g + cx) * 4 + ch] : pix[(y * g + x) * 4 + ch];
  const amount = CRUSH.sharpen;
  const lumaOnly = CRUSH.sharpenLuma;
  const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < g; y++) {
    for (let x = 0; x < g; x++) {
      const i = (y * g + x) * 4;
      if (!keep[y * g + x]) { d[i + 3] = 0; continue; }
      if (lumaOnly) {
        // One factor for all three channels, so the colour can only move along a
        // ray from the origin — same edge contrast, no hue-family hop.
        const l0 = pix[i] * 0.3 + pix[i + 1] * 0.59 + pix[i + 2] * 0.11;
        let blur = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          blur += at(x + dx, y + dy, 0, x, y) * 0.3 + at(x + dx, y + dy, 1, x, y) * 0.59 + at(x + dx, y + dy, 2, x, y) * 0.11;
        }
        blur = (blur + 4 * l0) / 8;
        // A black texel has no ray to scale along; leave it, rather than
        // dividing by ~0 and detonating the channel ratio.
        const k = l0 > 1e-3 ? clamp255(l0 + (l0 - blur) * amount) / l0 : 1;
        for (let ch = 0; ch < 3; ch++) d[i + ch] = clamp255(pix[i + ch] * k);
      } else {
        for (let ch = 0; ch < 3; ch++) {
          const c0 = pix[i + ch];
          const blur = (at(x - 1, y, ch, x, y) + at(x + 1, y, ch, x, y) + at(x, y - 1, ch, x, y) + at(x, y + 1, ch, x, y) + 4 * c0) / 8;
          d[i + ch] = clamp255(c0 + (c0 - blur) * amount);
        }
      }
      d[i + 3] = 255;
    }
  }

  // ── SELOUT on the shadow-side rim (see SELOUT_SHADOW) ──
  // Read from a copy: a pixel darkened here must not feed the next pixel's test.
  const shadow = CRUSH.selout;
  if (shadow > 0) {
    const ink = PAL_RGB[1];
    const pre = new Uint8ClampedArray(d);
    const K = (x: number, y: number): number => (x < 0 || y < 0 || x >= g || y >= g ? 0 : keep[y * g + x]);
    for (let y = 0; y < g; y++) {
      for (let x = 0; x < g; x++) {
        if (!K(x, y)) continue;
        if (K(x + 1, y) && K(x, y + 1)) continue; // interior, or a lit up-left rim
        const i = (y * g + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          d[i + ch] = pre[i + ch] * (1 - shadow) + ink[ch] * shadow;
        }
      }
    }
  }

  // ── palette snap ──
  for (let py = 0; py < g; py++) {
    for (let px = 0; px < g; px++) {
      const i = (py * g + px) * 4;
      if (!d[i + 3]) continue;
      const best = snapColor(d[i], d[i + 1], d[i + 2]);
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
  const ctx = crushableContext(canvas);
  if (!ctx) return null;
  paintInArtSpace(ctx, paint);
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
 * SUPERSAMPLE FACTOR — how many buffer pixels one art unit spans.
 *
 * Painters place coordinates in ART_PX space (CX=64, GROUND=118) and know
 * nothing about the buffer they land in. This is the one scale that reconciles
 * them, and it lives here rather than in the painters precisely so the buffer
 * can be resized — to make SPRITE_PX/SPRITE_PIXEL_GRID an exact integer — with
 * no art moving. Every site that hands a painter a context must apply it.
 *
 * Now derived inside `paintInArtSpace` from its `px` argument rather than held
 * as a module const, because the const was a MODULE-LOAD CAPTURE and that is
 * exactly what made the shipped rung untestable: `SPRITE_PX` is a player camera
 * setting read from localStorage at import, so a census could only ever measure
 * whichever rung the test process happened to boot at. Kept as the default.
 */

/**
 * Hand a painter a context in ART space.
 *
 * `save`/`restore` around the transform is not optional: painters translate,
 * rotate and clip freely, and several of them (the rotortail's whole body tilt,
 * the jester's spring) leave a transform set on purpose mid-frame.
 *
 * EXPORTED so tests can drive the real thing. Two suites used to hand-roll
 * "paint one frame the way paintFrame does", and the moment the buffer stopped
 * being the art's coordinate space both of them were silently comparing against
 * a path production no longer takes. A harness that re-implements the code it
 * checks only tests itself.
 *
 * `px` OVERRIDES THE BUFFER SIZE, FOR TESTS ONLY — see the note on
 * `crushToGrid`'s `grid` parameter for why this seam exists at all and why
 * `configureEngine` cannot provide it.
 */
export function paintInArtSpace(ctx: CanvasRenderingContext2D, paint: FramePaint, px: number = SPRITE_PX): void {
  const s = px / ART_PX;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingEnabled = true;
  paint(ctx);
  ctx.restore();
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
    // `willReadFrequently`: the crush now reads this canvas back with
    // `getImageData` on every single frame (it filters the source pixels itself
    // rather than handing them to `drawImage`), and on a GPU-backed canvas an
    // un-hinted readback forces a stall each time.
    _paintCtx = _paintCanvas.getContext("2d", { willReadFrequently: true });
    if (!_paintCtx) throw new Error("[dungeon] could not get 2D context for sprite frame");
  }
  const ctx = _paintCtx!;
  // Non-negotiable on a reused canvas: painters draw a character on a
  // transparent field and do not clear first, so without this every frame is
  // composited on top of the previous one.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SPRITE_PX, SPRITE_PX);
  // Painters mutate transform/alpha/composite freely. The save/restore inside
  // paintInArtSpace keeps one frame's leftover state from bleeding into the
  // next now that they share a context — with a fresh canvas per frame this
  // was free.
  paintInArtSpace(ctx, paint);
  // The strip cell is the GRID, not the paint box — the crushed art goes in at
  // its native size and is never scaled again between here and the screen.
  // Shared crush target: blitted on this line, never retained. See the warning
  // on crushToGridShared.
  strip.drawImage(crushToGridShared(_paintCanvas), col * SPRITE_PIXEL_GRID, row * SPRITE_PIXEL_GRID);
}

/**
 * Build one atlas for an actor. Frames are packed in a stable order and the
 * clip table records where each one landed. Every painter set with the same
 * clip structure produces the SAME layout — which is what lets a weapon swap
 * replace the texture without touching the animator.
 */
export function buildSpriteSheet(paints: ActorPaints, opts: SheetBuildOptions = {}): SpriteSheet {
  return startSpriteSheet(paints, opts).finish();
}

/**
 * A sheet re-dyed by `tint` and snapped back to the palette — the fix for the
 * tinted-reskin monsters rendering as noise.
 *
 * The expansion roster (wisp, sapper, necromancer, …) borrows another
 * monster's atlas and used to recolour it with `sprite.setTint`: a per-pixel
 * GPU multiply by a free RGB value. Every atlas texel is a palette entry, so
 * every MULTIPLIED texel is an off-palette colour — and the screen quantizer
 * then reassigns each one to whatever family happens to be nearest under the
 * luma-weighted metric. Measured on screen 2026-07-30: the sapper (magnet ×
 * 0xf0e05a) read as flat yellow with its ink dissolved, and the necromancer
 * (spitter × 0x8a5cd0) came out BLOOD RED on a warm floor. Same failure as
 * the free-hex marbles in [palette-snap-is-luma-weighted], institutionalised
 * in a spawn table.
 *
 * Baking does the same multiply ONCE, on the CPU, and then snaps each pixel
 * through the same LUT the crush uses — so the tinted monster is exactly as
 * palette-true as a hand-painted one, its selout ink snaps back to real ink
 * instead of a muddy blend, and the post chain has nothing to reinterpret.
 * The multiply matches what the GPU did (sRGB component product), so each
 * kind keeps its established identity, just expressed in palette entries.
 *
 * Alpha is untouched: the crush's hard cutout already decided the silhouette,
 * and re-deciding it here would move edges.
 */
export function bakeTintedSheet(src: SpriteSheet, tint: number): SpriteSheet {
  const srcCanvas = src.texture.image as HTMLCanvasElement;
  const canvas = document.createElement("canvas");
  canvas.width = srcCanvas.width;
  canvas.height = srcCanvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("[dungeon] could not get 2D context for tinted atlas");
  ctx.drawImage(srcCanvas, 0, 0);

  const tr = ((tint >> 16) & 0xff) / 255;
  const tg = ((tint >> 8) & 0xff) / 255;
  const tb = (tint & 0xff) / 255;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const PAL_RGB = palRgb();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const p = snapColor(d[i] * tr, d[i + 1] * tg, d[i + 2] * tb);
    d[i] = PAL_RGB[p][0];
    d[i + 1] = PAL_RGB[p][1];
    d[i + 2] = PAL_RGB[p][2];
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  celFilters(texture);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / src.cols, 1 / src.rows);
  // The clip map is layout data and the layout is identical — share it.
  return { texture, clips: src.clips, frameCount: src.frameCount, cols: src.cols, rows: src.rows };
}

/**
 * An atlas being painted a slice at a time.
 *
 * WHY THIS EXISTS. Painting an atlas is ~100 frames of vector art, each crushed
 * to the palette, in ONE synchronous call — and every caller reached for it from
 * somewhere the player was watching: the rAF loop on a weapon swap, or an idle
 * callback whose advisory deadline it blew through by 5x. Profiled over a 30 s
 * bot run (`scripts/lag-profile.mjs`), atlas painting owned 60% of all hitch
 * time, split 2,046 ms on the monster backfill and 857 ms on the knight.
 *
 * The sheet handle is valid the moment the build starts; unpainted cells are
 * transparent. That is safe ONLY because no owner hands a sheet out before
 * calling `finish()` on it. Keep that invariant — a half-painted atlas on screen
 * is an invisible monster, and nothing throws.
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

/** The same atlas, painted incrementally. See {@link SheetBuild}. */
/**
 * PER-SPRITE PALETTE LOCK — the RO/SNES palette-row model, derived not declared.
 *
 * The 32-entry master palette is the WORLD's budget. An individual creature does
 * not need all of it, and the ones that spend the most look the worst: the atlas
 * census is near-monotonic in entry count, with the cleanest actor (golem, 15)
 * at 6.9% orphan pixels and the busiest (jester, 32) at 34.9%.
 *
 * The complication is that a creature's colour count is NOT a matter of artist
 * discipline. Measured: the rotortail's painter declares 18 indices and its
 * atlas contains 26 — the downscale blends across texel boundaries and the
 * nearest-of-32 lookup sends each blend wherever the luma-weighted metric
 * points, frequently into another material family. A "use fewer colours" rule
 * cannot reach those, because they are chosen after the artist is finished.
 *
 * So the budget is enforced where the colours are actually decided: census the
 * FINISHED atlas, keep the entries that carry the sprite, and remap the rest
 * onto the nearest keeper. Entries then obey the cap by construction.
 *
 * DERIVED, NOT DECLARED, and that is a deliberate choice over hand-authoring a
 * subset per monster. A declared list covers only the kinds someone remembered
 * to write one for, and rots the moment a painter edits a ramp; the derived list
 * covers every sheet including the knight's, needs no registry, and — because it
 * is a pure function of a deterministic atlas — is reproducible. Its risk is
 * evicting a low-count intentional colour, which is what the two force-keeps
 * below exist for, and what `lockEviction` reports so a test can assert it.
 *
 * Cost is one pass over a finished atlas, on the same code path that already
 * does exactly that for tinted reskins.
 */
export interface LockReport {
  kept: number[];
  evicted: number[];
}

/** Last lock's eviction list, for tests. Not part of the render path. */
let _lastLock: LockReport | null = null;
export function lockEviction(): LockReport | null {
  return _lastLock;
}

function lockSheetPalette(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, cap: number): void {
  const PAL_RGB = palRgb();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const byRgb = new Map<number, number>();
  for (let i = 0; i < PAL_RGB.length; i++) {
    byRgb.set((PAL_RGB[i][0] << 16) | (PAL_RGB[i][1] << 8) | PAL_RGB[i][2], i);
  }
  const counts = new Uint32Array(PAL_RGB.length);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 127) continue;
    const hit = byRgb.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (hit !== undefined) counts[hit]++;
  }
  const present: number[] = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) present.push(i);
  if (present.length <= cap) { _lastLock = { kept: present, evicted: [] }; return; }

  const luma = (i: number): number => 0.3 * PAL_RGB[i][0] + 0.59 * PAL_RGB[i][1] + 0.11 * PAL_RGB[i][2];
  const keep = new Set<number>();
  // Ink and void first: index 1 is a quarter of every actor's pixels, and
  // losing it would dissolve the outline the whole read depends on.
  for (const i of [0, 1]) if (counts[i] > 0) keep.add(i);
  // The brightest present entry, whatever its count. Glow cores (17/18/31) are
  // a handful of texels — an eye, a fuse spark — and lose every popularity
  // contest while carrying the creature's focal point.
  keep.add(present.reduce((a, b) => (luma(b) > luma(a) ? b : a)));
  for (const i of [...present].sort((a, b) => counts[b] - counts[a])) {
    if (keep.size >= cap) break;
    keep.add(i);
  }

  // Remap every non-keeper onto its nearest keeper, under the SAME
  // luma-weighted metric the snap used to choose it. This is a family collapse,
  // not a re-quantisation: everything the master snap sent to rot-green lands on
  // the same rot-green keeper, so the sprite loses tones, never hues.
  const row = new Uint8Array(PAL_RGB.length);
  for (let i = 0; i < PAL_RGB.length; i++) {
    if (keep.has(i)) { row[i] = i; continue; }
    let best = -1;
    let bestDist = Infinity;
    for (const k of keep) {
      const dr = (PAL_RGB[i][0] - PAL_RGB[k][0]) * 0.3;
      const dg = (PAL_RGB[i][1] - PAL_RGB[k][1]) * 0.59;
      const db = (PAL_RGB[i][2] - PAL_RGB[k][2]) * 0.11;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = k; }
    }
    row[i] = best;
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 127) continue;
    const hit = byRgb.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (hit === undefined) continue;
    const to = row[hit];
    d[i] = PAL_RGB[to][0];
    d[i + 1] = PAL_RGB[to][1];
    d[i + 2] = PAL_RGB[to][2];
  }
  ctx.putImageData(img, 0, 0);
  _lastLock = { kept: [...keep].sort((a, b) => a - b), evicted: present.filter((i) => !keep.has(i)) };
}

export interface SheetBuildOptions {
  /** Cap the atlas's distinct palette entries. See lockSheetPalette. */
  lockEntries?: number;
}

export function startSpriteSheet(paints: ActorPaints, opts: SheetBuildOptions = {}): SheetBuild {
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
    while (next < flat.length) {
      paintFrame(ctx, flat[next], next % cols, Math.floor(next / cols));
      next++;
      // Checked AFTER a frame, never before: a zero budget must still make
      // progress, or a caller that always arrives with a spent deadline would
      // poll this build forever without it ever finishing.
      if (performance.now() >= limit) break;
    }
    const done = next >= flat.length;
    // ── UPLOAD ONCE, AT THE END ──
    //
    // Marking the texture dirty per slice cost more than the freeze it was
    // meant to remove. `needsUpdate` re-uploads the WHOLE atlas, which for the
    // knight is 8136x144 — so slicing an atlas into 40 pieces turned one upload
    // into forty, and measured p95 frame time went 18.2 ms → 30.4 ms with the
    // median unmoved: the signature of work spread across frames rather than
    // removed. Nothing renders a partial sheet (see SheetBuild), so there is
    // nothing to show until it is finished.
    if (done) {
      // The one moment the atlas is complete and before it reaches the GPU.
      // Deliberately NOT inside the crush: a per-cell lock cannot see the
      // sheet's own histogram, and wrapping the CALLER would silently miss the
      // frames that arrive later through `step()` from an idle callback —
      // first slice locked, rest not.
      if (opts.lockEntries) lockSheetPalette(canvas, ctx, opts.lockEntries);
      texture.needsUpdate = true;
    }
    return done;
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
  const ctx = crushableContext(canvas);
  if (!ctx) throw new Error("[dungeon] could not get 2D context for item sprite");
  paintInArtSpace(ctx, paint);

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
