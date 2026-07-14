/**
 * Pixel matrices → CanvasTexture atlas → billboarded sprite.
 *
 * All of an actor's frames are painted into ONE horizontal strip canvas, so the
 * whole actor is a single texture and animating is just an offset of
 * `texture.offset.x`. No per-frame texture swaps, no extra draw calls.
 *
 * BILLBOARDING: the camera is a fixed-angle orthographic camera, so we do NOT
 * need true per-frame billboarding. We tilt each sprite plane once, by exactly
 * the camera's elevation, and it faces the camera forever. That's cheaper, and
 * — more importantly — it keeps sprites pixel-aligned. True billboarding would
 * introduce sub-pixel rotation and make the art shimmer.
 *
 * The geometry's origin is at the BOTTOM-CENTRE (not the centre), so a sprite
 * positioned at a floor point has its feet on that point, and tilting it back
 * to face the camera pivots around the feet rather than sliding them.
 */
import * as THREE from "three";
import { CHARS, type ActorFrames, type Dir, type ClipName, type Frame } from "./sprite-data";
import { paletteCss } from "./palette";
import { SPRITE_PX, SPRITE_UNITS, CAMERA_TILT } from "../constants";

export interface SpriteSheet {
  texture: THREE.CanvasTexture;
  /** clipKey `${dir}:${clip}` → the frame indices in the atlas */
  clips: Map<string, number[]>;
  frameCount: number;
}

/** Paint one 16x16 frame into the strip canvas at slot `index`. */
function paintFrame(ctx: CanvasRenderingContext2D, frame: Frame, index: number): void {
  const x0 = index * SPRITE_PX;
  for (let y = 0; y < SPRITE_PX; y++) {
    const row = frame[y];
    for (let x = 0; x < SPRITE_PX; x++) {
      const ch = row[x];
      const pal = CHARS[ch];
      if (pal === undefined) {
        throw new Error(`[dungeon] unknown sprite char "${ch}" — add it to CHARS in sprite-data.ts`);
      }
      if (pal < 0) continue; // transparent
      ctx.fillStyle = paletteCss(pal);
      ctx.fillRect(x0 + x, y, 1, 1);
    }
  }
}

/**
 * Build one atlas for an actor. Frames are packed in a stable order and the
 * clip table records where each one landed.
 */
export function buildSpriteSheet(frames: ActorFrames): SpriteSheet {
  // Collect every frame across every direction and clip, in a stable order.
  const flat: Frame[] = [];
  const clips = new Map<string, number[]>();

  const dirs: Dir[] = ["S", "N", "E"];
  const clipNames: ClipName[] = ["idle", "walk", "attack", "death"];

  for (const dir of dirs) {
    for (const clip of clipNames) {
      const list = frames[dir][clip];
      if (!list) continue;
      const indices: number[] = [];
      for (const frame of list) {
        indices.push(flat.length);
        flat.push(frame);
      }
      clips.set(`${dir}:${clip}`, indices);
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = flat.length * SPRITE_PX;
  canvas.height = SPRITE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[dungeon] could not get 2D context for sprite atlas");
  ctx.imageSmoothingEnabled = false;

  flat.forEach((frame, i) => paintFrame(ctx, frame, i));

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
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
  dispose(): void;
}

export function createActorSprite(sheet: SpriteSheet, lit: boolean): ActorSprite {
  // Origin at the bottom-centre so the sprite stands ON its position.
  const geo = new THREE.PlaneGeometry(SPRITE_UNITS, SPRITE_UNITS);
  geo.translate(0, SPRITE_UNITS / 2, 0);

  // The texture is cloned per-sprite so two actors sharing a sheet can be on
  // different frames — the offset lives on the texture, not the material.
  const tex = sheet.texture.clone();
  tex.needsUpdate = true;

  const matOpts = {
    map: tex,
    transparent: true,
    alphaTest: 0.5, // hard-edged cutout. No soft alpha — this is pixel art.
    side: THREE.DoubleSide,
  };

  const mat = lit
    ? new THREE.MeshLambertMaterial(matOpts)
    : new THREE.MeshBasicMaterial(matOpts);

  const mesh = new THREE.Mesh(geo, mat);

  // Face the camera: rotating by -tilt about X points the plane's normal
  // up-and-toward an elevated camera. Derivation: Rx(θ) maps the plane's
  // default normal (0,0,1) to (0,-sinθ,cosθ); we want (0,sin·tilt,cos·tilt),
  // so θ = -tilt.
  mesh.rotation.x = -CAMERA_TILT;
  mesh.renderOrder = 10;

  let flipped = false;
  let currentFrame = 0;

  // When repeat.x is negative the texture reads right-to-left, so the offset has
  // to anchor on the frame's RIGHT edge instead of its left. Get this wrong and
  // a flipped sprite shows the neighbouring frame.
  function applyFrame(): void {
    tex.offset.x = flipped ? (currentFrame + 1) / sheet.frameCount : currentFrame / sheet.frameCount;
  }

  function setFrame(index: number): void {
    if (index === currentFrame) return;
    currentFrame = index;
    applyFrame();
  }

  function setFlipped(next: boolean): void {
    if (next === flipped) return;
    flipped = next;
    tex.repeat.x = (flipped ? -1 : 1) / sheet.frameCount;
    applyFrame(); // repeat changed — the offset anchor moved with it
  }

  applyFrame();

  return {
    mesh,
    sheet,
    setFrame,
    setFlipped,
    dispose: () => {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
