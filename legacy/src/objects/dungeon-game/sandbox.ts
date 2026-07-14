/**
 * Phase 0 — the style sandbox.
 *
 * A hand-placed stone room, torches, and two actors standing in it. No maze, no
 * AI, no combat. The ONLY job of this file is to give us something to look at
 * while we get the 8-bit look right.
 *
 * Everything here gets thrown away in Phase 2 when maze/build.ts replaces it.
 * Don't grow it.
 *
 * Textures are authored at exactly 16x16 px and tiled once per world unit, so
 * one texel lands on exactly one screen pixel (PPU = 16). Any other size and the
 * floor detail would be resampled and go mushy.
 */
import * as THREE from "three";
import { PALETTE_HEX } from "./render/palette";
import { SANDBOX_W, SANDBOX_D, WALL_H, PPU } from "./constants";

/** Deterministic hash-noise — no Math.random, so the room looks identical every run. */
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
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

const css = (i: number) => `#${PALETTE_HEX[i].toString(16).padStart(6, "0")}`;

/**
 * Flagstone floor: mortar grid + speckled stone.
 *
 * The texture covers a FLOOR_BLOCK x FLOOR_BLOCK patch of tiles, not a single
 * tile. That matters: with a one-tile texture, the identical speckle pattern
 * repeats on every single flagstone and the floor stops reading as stone and
 * starts reading as wallpaper. Four tiles of noise per repeat is enough to break
 * the eye's pattern-matching.
 */
const FLOOR_BLOCK = 4;

function makeFloorTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const size = PPU * FLOOR_BLOCK;
  return pixelTexture(
    size,
    (ctx) => {
      ctx.fillStyle = css(3);
      ctx.fillRect(0, 0, size, size);

      // Sparse speckle. Keep it SPARSE: the camera is tilted 35°, so a 16px
      // floor tile is only ~9px tall on screen and the texture is minified
      // vertically. Dense per-pixel noise turns into shimmering moiré under that
      // minification — a few chips read as stone, a full noise field reads as
      // television static.
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = noise(x, y, 1);
          if (n > 0.975) {
            ctx.fillStyle = css(4);
            ctx.fillRect(x, y, 1, 1);
          } else if (n < 0.025) {
            ctx.fillStyle = css(2);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // Mortar seams every PPU px → a flagstone grid at exactly one tile pitch.
      // fillRect is (x, y, w, h): a HORIZONTAL seam at height p is
      // (0, p, size, 1), and a VERTICAL seam at column p is (p, 0, 1, size).
      // Swapping those two only draws along the texture's edges, which makes the
      // grid appear every FLOOR_BLOCK tiles instead of every tile.
      for (let i = 0; i < FLOOR_BLOCK; i++) {
        const p = i * PPU;
        ctx.fillStyle = css(1);
        ctx.fillRect(0, p, size, 1); // horizontal
        ctx.fillRect(p, 0, 1, size); // vertical
        // A lighter chip just under each horizontal seam, so the flagstones read
        // as bevelled rather than as lines drawn on a flat sheet.
        ctx.fillStyle = css(2);
        ctx.fillRect(0, p + 1, size, 1);
      }
    },
    repeatX,
    repeatY,
  );
}

/** Wall face: coursed blocks, darker than the floor so silhouettes read. */
function makeWallTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  return pixelTexture(
    PPU,
    (ctx) => {
      ctx.fillStyle = css(2);
      ctx.fillRect(0, 0, PPU, PPU);

      for (let y = 0; y < PPU; y++) {
        for (let x = 0; x < PPU; x++) {
          const n = noise(x, y, 7);
          if (n > 0.93) {
            ctx.fillStyle = css(3);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // block courses — offset every other row so it looks laid, not printed
      ctx.fillStyle = css(1);
      ctx.fillRect(0, 0, PPU, 1);
      ctx.fillRect(0, 8, PPU, 1);
      ctx.fillRect(0, 0, 1, 8);
      ctx.fillRect(8, 8, 1, 8);
    },
    repeatX,
    repeatY,
  );
}

export interface Sandbox {
  group: THREE.Group;
  torchLights: THREE.PointLight[];
  dispose(): void;
}

/**
 * Build the room. Origin is the room centre; the floor sits at y = 0 and the
 * playable area spans [-W/2, W/2] x [-D/2, D/2].
 */
export function buildSandbox(scene: THREE.Scene): Sandbox {
  const group = new THREE.Group();
  const torchLights: THREE.PointLight[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ── Floor ──
  // repeat is in BLOCKS now, not tiles — the texture spans FLOOR_BLOCK tiles.
  const floorTex = track(makeFloorTexture(SANDBOX_W / FLOOR_BLOCK, SANDBOX_D / FLOOR_BLOCK));
  const floorMat = track(new THREE.MeshLambertMaterial({ map: floorTex }));
  const floorGeo = track(new THREE.PlaneGeometry(SANDBOX_W, SANDBOX_D));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ── Walls — a ring of boxes around the floor ──
  const wallTex = track(makeWallTexture(1, WALL_H));
  const wallMat = track(new THREE.MeshLambertMaterial({ map: wallTex }));
  const wallCapMat = track(new THREE.MeshLambertMaterial({ color: PALETTE_HEX[2] }));
  const wallGeo = track(new THREE.BoxGeometry(1, WALL_H, 1));

  // BoxGeometry material order: +x, -x, +y, -y, +z, -z. Give the top a flat cap
  // so the wall tops don't smear a vertical wall texture across a horizontal face.
  const wallMats = [wallMat, wallMat, wallCapMat, wallCapMat, wallMat, wallMat];

  const halfW = SANDBOX_W / 2;
  const halfD = SANDBOX_D / 2;

  const addWall = (x: number, z: number) => {
    const w = new THREE.Mesh(wallGeo, wallMats);
    w.position.set(x, WALL_H / 2, z);
    w.castShadow = true;
    w.receiveShadow = true;
    group.add(w);
  };

  for (let x = -halfW - 0.5; x <= halfW + 0.5; x += 1) {
    addWall(x, -halfD - 0.5);
    addWall(x, halfD + 0.5);
  }
  for (let z = -halfD + 0.5; z <= halfD - 0.5; z += 1) {
    addWall(-halfW - 0.5, z);
    addWall(halfW + 0.5, z);
  }

  // A couple of free-standing pillars, so we can see how walls occlude actors
  // and how shadows band under the palette quantizer.
  addWall(-3, -2);
  addWall(3, 2);

  // ── Torches ──
  const sconceGeo = track(new THREE.BoxGeometry(0.18, 0.3, 0.18));
  const sconceMat = track(new THREE.MeshLambertMaterial({ color: PALETTE_HEX[19] }));
  const flameGeo = track(new THREE.BoxGeometry(0.22, 0.3, 0.22));
  // Basic (unlit) so the flame is always the brightest thing on screen and
  // lands on the top of the torch ramp after quantization.
  const flameMat = track(new THREE.MeshBasicMaterial({ color: PALETTE_HEX[17] }));

  const addTorch = (x: number, z: number) => {
    const sconce = new THREE.Mesh(sconceGeo, sconceMat);
    sconce.position.set(x, 1.0, z);
    group.add(sconce);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, 1.28, z);
    group.add(flame);

    // Tight, short-range pools. An earlier pass had these at intensity 18 /
    // range 11, which lit the ENTIRE room warm — and the palette quantizer then
    // faithfully snapped all that stone into the leather/ember browns, so the
    // "cold crypt" came out looking like a cosy burrow. Torches must fall off
    // fast enough that most of the floor stays cold.
    const light = new THREE.PointLight(PALETTE_HEX[16], 6, 6, 2);
    light.position.set(x, 1.35, z);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    group.add(light);
    torchLights.push(light);
  };

  addTorch(-halfW + 0.4, -halfD + 1.5);
  addTorch(halfW - 0.4, halfD - 1.5);
  addTorch(0, -halfD + 0.4);

  scene.add(group);

  return {
    group,
    torchLights,
    dispose() {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
