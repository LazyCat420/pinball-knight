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
import { WALL_H, WALL_LOW, PPU, TORCH_LIGHT_POOL } from "../constants";
import { type Grid, isWalkable, tileCenter } from "./generator";
import type { LevelPlan } from "./decorate";

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

      // Per-tile character: some flagstones are mossy, a few are cracked,
      // one or two are sunken (darker). Hash-keyed so the pattern is stable.
      for (let tj = 0; tj < FLOOR_BLOCK; tj++) {
        for (let ti = 0; ti < FLOOR_BLOCK; ti++) {
          const h = noise(ti * 3.7, tj * 5.1, 42);
          const x0 = ti * PPU;
          const y0 = tj * PPU;
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
              cx = Math.max(2, Math.min(PPU - 3, cx));
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

/** Wall face: coursed blocks, darker than the floor so silhouettes read.
 * `mossy` grows green up from the base — the variant that breaks up long runs. */
function makeWallTexture(repeatX: number, repeatY: number, mossy = false): THREE.CanvasTexture {
  const half = PPU / 2;
  return pixelTexture(
    PPU,
    (ctx) => {
      ctx.fillStyle = css(2);
      ctx.fillRect(0, 0, PPU, PPU);

      for (let y = 0; y < PPU; y++) {
        for (let x = 0; x < PPU; x++) {
          if (noise(x, y, 7) > 0.95) {
            ctx.fillStyle = css(3);
            ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      // Block courses — offset every other row so it looks laid, not printed.
      ctx.fillStyle = css(1);
      ctx.fillRect(0, 0, PPU, 1);
      ctx.fillRect(0, half, PPU, 1);
      ctx.fillRect(0, 0, 1, half);
      ctx.fillRect(half, half, 1, half);

      if (mossy) {
        // Damp rot climbing from the floor — denser at the bottom.
        for (let y = half; y < PPU; y++) {
          const density = (y - half) / half; // 0 at mid, 1 at base
          for (let x = 0; x < PPU; x++) {
            if (noise(x, y, 21) < density * 0.55) {
              ctx.fillStyle = css(noise(x, y, 23) > 0.6 ? 7 : 6);
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
      }

      // Contact shadow along the bottom of the face — grounds the wall on the
      // floor and separates face from floor even under flat ambient.
      ctx.fillStyle = css(0);
      ctx.fillRect(0, PPU - 2, PPU, 2);
    },
    repeatX,
    repeatY,
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
    },
    1,
    1,
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
  dispose(): void;
}

export function buildMaze(scene: THREE.Scene, grid: Grid, plan: LevelPlan): MazeHandle {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ── Floor — one plane under the whole grid ──
  const floorTex = track(makeFloorTexture(grid.w / FLOOR_BLOCK, grid.h / FLOOR_BLOCK));
  const floorMat = track(new THREE.MeshLambertMaterial({ map: floorTex }));
  const floorGeo = track(new THREE.PlaneGeometry(grid.w, grid.h));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // ── Walls — sort into full (back) and low (camera-side rim) ──
  // Only wall tiles with at least one walkable neighbour (8-way) get an
  // instance: a wall buried inside a solid block can never be seen.
  const fullCells: Array<{ x: number; z: number }> = [];
  const mossCells: Array<{ x: number; z: number }> = [];
  const lowCells: Array<{ x: number; z: number }> = [];
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      if (isWalkable(grid, i, j)) continue;
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
      const c = tileCenter(grid, i, j);
      if (rim) {
        lowCells.push(c);
      } else if ((i * 7 + j * 13) % 4 === 0) {
        mossCells.push(c); // every ~4th tall wall grows moss — breaks up runs
      } else {
        fullCells.push(c);
      }
    }
  }

  const capTex = track(makeCapTexture());
  const capMat = track(new THREE.MeshLambertMaterial({ map: capTex }));

  const addWallMesh = (cells: Array<{ x: number; z: number }>, height: number, mossy: boolean): void => {
    if (!cells.length) return;
    const faceTex = track(makeWallTexture(1, height, mossy));
    const faceMat = track(new THREE.MeshLambertMaterial({ map: faceTex }));
    const geo = track(new THREE.BoxGeometry(1, height, 1));
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z — bordered grid cap
    // on top so the coursed texture doesn't smear across a horizontal face.
    const mesh = new THREE.InstancedMesh(geo, [faceMat, faceMat, capMat, capMat, faceMat, faceMat], cells.length);
    const m = new THREE.Matrix4();
    cells.forEach((c, k) => {
      m.setPosition(c.x, height / 2, c.z);
      mesh.setMatrixAt(k, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    disposables.push({ dispose: () => mesh.dispose() });
  };

  addWallMesh(fullCells, WALL_H, false);
  addWallMesh(mossCells, WALL_H, true);
  addWallMesh(lowCells, WALL_LOW, false);

  // ── Stairs down — a dark descending notch with an arcane glow ──
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
  // The only cold light in the level — descending should look uncanny, not
  // cosy. Not part of the torch pool; it's always on.
  const stairGlow = new THREE.PointLight(PALETTE_HEX[31], 2.5, 3.2, 2);
  stairGlow.position.set(sc.x, 0.5, sc.z);
  group.add(stairGlow);

  // ── Torches — sconce + flame everywhere, lights from a pool ──
  const sconceGeo = track(new THREE.BoxGeometry(0.18, 0.3, 0.18));
  const sconceMat = track(new THREE.MeshLambertMaterial({ color: PALETTE_HEX[19] }));
  const flameGeo = track(new THREE.BoxGeometry(0.22, 0.3, 0.22));
  // Basic (unlit) so a flame is always the brightest thing on screen, lit or not.
  const flameMat = track(new THREE.MeshBasicMaterial({ color: PALETTE_HEX[17] }));

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
    group.add(sconce);

    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, wallH * 0.62 + 0.26, z);
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
    dispose() {
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
    },
  };
}
