/**
 * sprite-forge atlas loader — the bridge between offline-made pixel art and
 * the in-game Animator.
 *
 * ../tools/sprite-forge/pack.mjs packs converted frames into a single horizontal
 * strip PNG plus a manifest JSON, published under public/dungeon/sprites/.
 * This loader turns that pair into a SpriteSheet that is drop-in compatible
 * with the procedural sheets from buildSpriteSheet — same clip-key scheme
 * ("S:idle", "E:attack", …), same single-strip texture contract.
 *
 * Missing art is NOT an error: every load falls back to null and the caller
 * keeps the procedural sheet. That's the migration path — hand-made art
 * replaces painters one character at a time as PNGs appear.
 */
import * as THREE from "three";
import type { SpriteSheet } from "./sprite";

interface AtlasManifest {
  /** Total frames in the strip. */
  frames: number;
  /** Clip table: "S:idle" → frame indices into the strip. */
  clips: Record<string, number[]>;
}

const BASE = "/dungeon/sprites";

export async function loadAtlasSheet(name: string): Promise<SpriteSheet | null> {
  try {
    const res = await fetch(`${BASE}/${name}.json`);
    if (!res.ok) return null;
    const manifest = (await res.json()) as AtlasManifest;
    if (!manifest.frames || !manifest.clips) return null;

    const img = new Image();
    img.src = `${BASE}/${name}.png`;
    await img.decode();

    // Draw onto a canvas so the result is a CanvasTexture like every other
    // sheet (and so the browser can drop the decoded Image afterwards).
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.drawImage(img, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(1 / manifest.frames, 1);

    return {
      texture,
      frameCount: manifest.frames,
      clips: new Map(Object.entries(manifest.clips)),
    };
  } catch {
    return null; // no art yet — procedural painter stays in charge
  }
}
