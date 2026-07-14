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
import { PALETTE_HEX } from "./palette";
import { SPRITE_PX, SPRITE_UNITS, CAMERA_TILT, CAMERA_YAW } from "../constants";

/**
 * Face the isometric camera exactly: yaw to the camera's heading, then tilt
 * back by its elevation (rotation order YXZ makes the X tilt local). Because
 * the camera is orthographic and the plane ends up perpendicular to the view
 * ray, sprite texels stay square on screen. Rotation pivots on the
 * bottom-centre origin — the feet stay planted.
 */
function faceCamera(mesh: THREE.Mesh): void {
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = CAMERA_YAW;
  mesh.rotation.x = -CAMERA_TILT;
}

export interface SpriteSheet {
  texture: THREE.CanvasTexture;
  /** clipKey `${dir}:${clip}` → the frame indices in the atlas */
  clips: Map<string, number[]>;
  frameCount: number;
}

/** Smooth filtering — this is cel art now, not pixel art. */
function celFilters(tex: THREE.CanvasTexture): void {
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
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
  strip.drawImage(scratch, index * SPRITE_PX, 0);
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
  const clipNames: ClipName[] = ["idle", "walk", "attack", "death"];

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
  canvas.width = flat.length * SPRITE_PX;
  canvas.height = SPRITE_PX;
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
  dispose(): void;
}

export function createActorSprite(sheet: SpriteSheet, lit: boolean): ActorSprite {
  // Origin at the bottom-centre so the sprite stands ON its position.
  const geo = new THREE.PlaneGeometry(SPRITE_UNITS, SPRITE_UNITS);
  geo.translate(0, SPRITE_UNITS / 2, 0);

  // The texture is cloned per-sprite so two actors sharing a sheet can be on
  // different frames — the offset lives on the texture, not the material.
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
    dispose: () => {
      geo.dispose();
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
export function createStaticSprite(paint: FramePaint): { mesh: THREE.Mesh; dispose(): void } {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[dungeon] could not get 2D context for item sprite");
  ctx.imageSmoothingEnabled = true;
  paint(ctx);

  const tex = new THREE.CanvasTexture(canvas);
  celFilters(tex);

  const geo = new THREE.PlaneGeometry(SPRITE_UNITS, SPRITE_UNITS);
  geo.translate(0, SPRITE_UNITS / 2, 0);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  faceCamera(mesh);
  mesh.renderOrder = 5; // under actors, over the floor

  return {
    mesh,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
