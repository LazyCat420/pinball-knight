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
import type { ActorPaints, Dir, ClipName, FramePaint } from "./cel-painter";
import { makeReaperPaints } from "./cel-painter";
import { PALETTE_HEX } from "./palette";
import { SPRITE_PX, SPRITE_UNITS, SPRITE_PIXEL_GRID, CAMERA_TILT, CAMERA_YAW } from "../constants";

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
function blobTexture(): THREE.CanvasTexture {
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
const PAL_RGB = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

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
export function crushToGrid(src: HTMLCanvasElement): HTMLCanvasElement {
  const g = SPRITE_PIXEL_GRID;
  const small = document.createElement("canvas");
  small.width = g;
  small.height = g;
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(src, 0, 0, g, g);
  const im = sctx.getImageData(0, 0, g, g);
  const d = im.data;
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
      const cr = d[i] + bias;
      const cg = d[i + 1] + bias;
      const cb = d[i + 2] + bias;
      let best = 0;
      let bestDist = Infinity;
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
      d[i] = PAL_RGB[best][0];
      d[i + 1] = PAL_RGB[best][1];
      d[i + 2] = PAL_RGB[best][2];
      d[i + 3] = 255;
    }
  }
  sctx.putImageData(im, 0, 0);
  return small;
}

/**
 * Rasterize a single FramePaint to a pixel-art data-URL — the SAME palette-crush
 * the in-world sprites get (crushToGrid: SPRITE_PIXEL_GRID snap + Bayer dither
 * + nearest upscale). Used for DOM icons (the Tavern's buy-menu) so a shop item
 * shows the game's actual pixel art instead of an emoji. Cache the result — the
 * crush is not free.
 */
export function renderPaintIcon(paint: FramePaint): string {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
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
  return crushToGrid(canvas).toDataURL();
}

/** Paint one frame on a scratch canvas and blit it into the strip at `index`. */
function paintFrame(strip: CanvasRenderingContext2D, paint: FramePaint, index: number): void {
  const scratch = document.createElement("canvas");
  scratch.width = SPRITE_PX;
  scratch.height = SPRITE_PX;
  const ctx = scratch.getContext("2d");
  if (!ctx) throw new Error("[dungeon] could not get 2D context for sprite frame");
  ctx.imageSmoothingEnabled = true;
  paint(ctx);
  // The strip cell is the GRID, not the paint box — the crushed art goes in at
  // its native size and is never scaled again between here and the screen.
  strip.drawImage(crushToGrid(scratch), index * SPRITE_PIXEL_GRID, 0);
}

/**
 * Build one atlas for an actor. Frames are packed in a stable order and the
 * clip table records where each one landed. Every painter set with the same
 * clip structure produces the SAME layout — which is what lets a weapon swap
 * replace the texture without touching the animator.
 */
export function buildSpriteSheet(paints: ActorPaints): SpriteSheet {
  const flat: FramePaint[] = [];
  const clips = new Map<string, number[]>();

  const dirs: Dir[] = ["S", "N", "E"];
  // Every clip an actor might author. `roll` is knight-only; actors that don't
  // define a clip are skipped (the `if (!list) continue` below), so listing
  // them all here is harmless and keeps new clips from silently vanishing.
  const clipNames: ClipName[] = ["idle", "walk", "run", "attack", "death", "roll", "ball", "equip", "forge"];

  for (const dir of dirs) {
    for (const clip of clipNames) {
      const list = paints[dir][clip];
      if (!list) continue;
      const indices: number[] = [];
      for (const paint of list) {
        indices.push(flat.length);
        flat.push(paint);
      }
      clips.set(`${dir}:${clip}`, indices);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = flat.length * SPRITE_PIXEL_GRID;
  canvas.height = SPRITE_PIXEL_GRID;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[dungeon] could not get 2D context for sprite atlas");

  flat.forEach((paint, i) => paintFrame(ctx, paint, i));

  const texture = new THREE.CanvasTexture(canvas);
  celFilters(texture);
  texture.wrapS = THREE.RepeatWrapping; // needed for the flip trick below
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // Show exactly one frame at a time.
  texture.repeat.set(1 / flat.length, 1);

  return { texture, clips, frameCount: flat.length };
}

/**
 * The reaper's atlas, built on FIRST USE and cached for the session.
 *
 * Every other actor's sheet is built up-front in core.ts's init, but the reaper
 * appears at most once per floor and only after REAPER_AFTER seconds — most
 * runs never see one. Building it lazily behind this accessor keeps the level
 * boot cost unchanged and, more usefully here, means adding bespoke reaper art
 * needs exactly one line changed at the call site instead of a new field
 * threaded through state/init/dispose.
 */
let cachedReaperSheet: SpriteSheet | null = null;
export function reaperSheet(): SpriteSheet {
  if (!cachedReaperSheet) cachedReaperSheet = buildSpriteSheet(makeReaperPaints());
  return cachedReaperSheet;
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
    tex.offset.x = flipped ? (currentFrame + 1) / api.sheet.frameCount : currentFrame / api.sheet.frameCount;
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
      tex.repeat.x = (flipped ? -1 : 1) / api.sheet.frameCount;
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
      tex.repeat.set((flipped ? -1 : 1) / next.frameCount, 1);
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
    color: PALETTE_HEX[30], // arcane mid — reads as "you, behind the wall"
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
  const ctx = canvas.getContext("2d");
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
