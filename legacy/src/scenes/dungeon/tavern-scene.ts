/**
 * 🍺 THE TAVERN — 3D scene. The between-floor hub, rendered in the SAME
 * isometric cel/pixel style as the dungeon (the DOM overlay in tavern.ts is just
 * the shop UI layered on top of this). Reuses the dungeon's render pipeline
 * wholesale: `createPixelPass` (the quantize + dither + outline + bloom + AO +
 * scanline crush), the iso ortho camera, the game's lights, and billboarded
 * `NPC_PAINTS` sprites for the keepers — so the tavern reads as the same game.
 *
 * Self-contained + defensive: if a WebGL context can't be had, `createTavernScene`
 * returns null and the caller falls back to a flat DOM room. Owns its own
 * renderer/scene/loop and disposes them on close.
 */
import * as THREE from "three";
import { createPixelPass, type PixelPass } from "./render/pixel-pass";
import { createDungeonCamera, aimCamera } from "./camera";
import { createStaticSprite } from "./render/sprite";
import { NPC_PAINTS } from "./render/cel-painter";
import { PALETTE_HEX } from "./render/palette";
import {
  WALL_H,
  CAMERA_YAW,
  CAMERA_TILT,
  AMBIENT_INTENSITY,
  HEMI_INTENSITY,
  DIR_INTENSITY,
  DIR_HEIGHT,
  SHADOW_OPACITY,
  QUANTIZE_DEFAULT,
  DITHER_DEFAULT,
  SCANLINE_DEFAULT,
  OUTLINE_DEFAULT,
  BLOOM_DEFAULT,
  AO_DEFAULT,
} from "./constants";

/** One keeper to place in the room. */
export interface TavernNpcSpot {
  id: string;
  paintKey: string; // a NPC_PAINTS key (witch / magician / merchant / frog)
  x: number;
  z: number;
}

export interface TavernScene {
  /** The pixel-pass canvas (full-window, imageRendering:pixelated). */
  canvas: HTMLCanvasElement;
  /** Project a keeper's head to viewport px, for placing its DOM name-plate. */
  projectNpc(id: string): { x: number; y: number } | null;
  dispose(): void;
}

// ── palette shorthands (indices per render/palette.ts) ──
const VOID = PALETTE_HEX[0];
const STONE_DK = PALETTE_HEX[2];
const STONE = PALETTE_HEX[3];
const WOOD = PALETTE_HEX[27]; // leather/wood mid — the plank floor
const WOOD_DK = PALETTE_HEX[26];
const FLAME = PALETTE_HEX[16]; // torch flame — clears the bloom threshold when unlit-material

/** A cel-style solid (lambert, shadow-casting) box at (x,y,z). */
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 }));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** An unlit emissive quad billboarded to the iso camera (bloom halos it). */
function emissiveQuad(w: number, h: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  m.position.set(x, y, z);
  m.rotation.order = "YXZ";
  m.rotation.y = CAMERA_YAW;
  m.rotation.x = -CAMERA_TILT;
  m.renderOrder = 8;
  return m;
}

export function createTavernScene(container: HTMLElement, npcs: TavernNpcSpot[]): TavernScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  } catch (e) {
    console.warn("[tavern] no WebGL — falling back to DOM room", e);
    return null;
  }
  try {
    renderer.setClearColor(VOID);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const pixelPass = createPixelPass(renderer, {
      quantize: QUANTIZE_DEFAULT,
      dither: DITHER_DEFAULT,
      scanline: SCANLINE_DEFAULT,
      outline: OUTLINE_DEFAULT,
      bloom: BLOOM_DEFAULT,
      ao: AO_DEFAULT,
    });
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(VOID);

    // Room centred on the origin. Floor spans FW×FD tiles; the camera looks in
    // from the +x/+z iso corner, so the "back" walls are the -x and -z edges.
    const FW = 9;
    const FD = 7;
    const cx = 0;
    const cz = 0;

    // ── Lights (biome-0 values, mirrors core.ts) ──
    scene.add(new THREE.AmbientLight(0x6b7d99, AMBIENT_INTENSITY));
    scene.add(new THREE.HemisphereLight(0x8fa3bd, 0x1e2430, HEMI_INTENSITY));
    const sun = new THREE.DirectionalLight(0xa7c0e0, DIR_INTENSITY);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = DIR_HEIGHT * 2.5;
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.04;
    sun.shadow.intensity = 1 - SHADOW_OPACITY;
    sun.position.set(cx - DIR_HEIGHT * 0.55, DIR_HEIGHT, cz - DIR_HEIGHT * 0.55);
    sun.target.position.set(cx, 0, cz);
    scene.add(sun, sun.target);
    // The hearth's warm pool of firelight.
    const fireLight = new THREE.PointLight(FLAME, 7, 9, 2);
    fireLight.position.set(cx, 0.9, cz - FD / 2 + 0.6);
    scene.add(fireLight);

    const disposables: Array<{ geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }> = [];
    const addMesh = (m: THREE.Mesh): THREE.Mesh => {
      scene.add(m);
      disposables.push(m);
      return m;
    };

    // ── Floor: a wood-plank slab ──
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.95, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    addMesh(floor);
    // A rug of darker planks under the fireplace, for a little floor variety.
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(FW * 0.5, FD * 0.4), new THREE.MeshStandardMaterial({ color: WOOD_DK, roughness: 0.97 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(cx, 0.01, cz - FD * 0.2);
    rug.receiveShadow = true;
    addMesh(rug);

    // ── Back + side walls (the two edges the iso camera faces) ──
    const WH = WALL_H * 1.7;
    addMesh(box(FW, WH, 0.5, STONE_DK, cx, WH / 2, cz - FD / 2 - 0.25));
    addMesh(box(0.5, WH, FD, STONE_DK, cx - FW / 2 - 0.25, WH / 2, cz));
    // a low rim on the two near edges so the room reads enclosed but open to view
    addMesh(box(FW, WALL_H * 0.4, 0.4, STONE, cx, WALL_H * 0.2, cz + FD / 2 + 0.2));

    // ── Fireplace on the back wall: stone surround + dark firebox + flames ──
    addMesh(box(1.9, 1.5, 0.5, STONE, cx, 0.75, cz - FD / 2 + 0.1)); // surround
    addMesh(box(1.2, 0.5, 0.35, STONE_DK, cx, 1.55, cz - FD / 2 + 0.15)); // mantel
    addMesh(box(1.1, 0.85, 0.15, 0x120a05, cx, 0.5, cz - FD / 2 + 0.32)); // firebox cavity
    const flames = [
      emissiveQuad(0.62, 0.8, FLAME, cx, 0.55, cz - FD / 2 + 0.42),
      emissiveQuad(0.4, 0.55, PALETTE_HEX[17], cx - 0.02, 0.5, cz - FD / 2 + 0.46),
      emissiveQuad(0.24, 0.36, PALETTE_HEX[18], cx + 0.01, 0.46, cz - FD / 2 + 0.5),
    ];
    flames.forEach((f) => addMesh(f));

    // ── A couple of props: barrels + a table, so the room isn't bare ──
    const barrelMat = 25; // wood/leather-ish
    addMesh(box(0.5, 0.7, 0.5, PALETTE_HEX[barrelMat], cx + FW / 2 - 0.7, 0.35, cz - FD / 2 + 0.8));
    addMesh(box(0.5, 0.55, 0.5, PALETTE_HEX[barrelMat], cx + FW / 2 - 0.7, 0.28, cz - FD / 2 + 1.5));
    addMesh(box(1.4, 0.12, 0.8, WOOD_DK, cx - FW / 2 + 1.3, 0.62, cz + 0.4)); // table top
    addMesh(box(0.1, 0.6, 0.1, WOOD_DK, cx - FW / 2 + 0.75, 0.3, cz + 0.05)); // a leg (suggested)

    // ── Keeper NPC sprites (billboarded cel sprites) ──
    const npcSprites = new Map<string, { sprite: ReturnType<typeof createStaticSprite>; x: number; z: number }>();
    for (const n of npcs) {
      const paint = NPC_PAINTS[n.paintKey] ?? NPC_PAINTS.merchant;
      const s = createStaticSprite(paint);
      s.mesh.position.set(n.x, 0, n.z);
      scene.add(s.mesh);
      npcSprites.set(n.id, { sprite: s, x: n.x, z: n.z });
    }

    // ── Camera: fixed iso, zoomed to frame the room ──
    const camera = createDungeonCamera();
    camera.zoom = 1.85;
    camera.updateProjectionMatrix();
    aimCamera(camera, cx, 0.7, cz);

    // ── Render loop ──
    let raf = 0;
    const _v = new THREE.Vector3();
    const onResize = (): void => pixelPass.resize();
    window.addEventListener("resize", onResize);
    const frame = (): void => {
      const t = performance.now() / 1000;
      // Fire flicker — the light pool breathes and the flame quads dance.
      const fl = 0.82 + Math.sin(t * 11) * 0.11 + Math.sin(t * 6.3) * 0.07;
      fireLight.intensity = 7 * fl;
      flames.forEach((f, i) => {
        f.scale.set(1 + Math.sin(t * (9 + i * 2)) * 0.08, fl * (1 + Math.sin(t * (7 + i)) * 0.12), 1);
        (f.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.abs(Math.sin(t * (13 + i * 3)));
      });
      // Keepers bob gently in place.
      for (const { sprite, x } of npcSprites.values()) sprite.mesh.position.y = Math.sin(t * 1.7 + x * 2) * 0.03;
      pixelPass.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return {
      canvas: renderer.domElement,
      projectNpc(id: string): { x: number; y: number } | null {
        const n = npcSprites.get(id);
        if (!n) return null;
        _v.set(n.x, 0.95, n.z).project(camera); // ~head height
        const rect = renderer.domElement.getBoundingClientRect();
        return {
          x: rect.left + (_v.x * 0.5 + 0.5) * rect.width,
          y: rect.top + (1 - (_v.y * 0.5 + 0.5)) * rect.height,
        };
      },
      dispose(): void {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        for (const { sprite } of npcSprites.values()) sprite.dispose();
        for (const d of disposables) {
          d.geometry?.dispose();
          const mat = d.material;
          if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
          else mat?.dispose();
        }
        pixelPass.dispose();
        renderer.dispose();
        renderer.domElement.parentElement?.removeChild(renderer.domElement);
        scene.clear();
      },
    };
  } catch (e) {
    console.warn("[tavern] 3D scene setup failed — falling back to DOM room", e);
    try {
      renderer.dispose();
      renderer.domElement.parentElement?.removeChild(renderer.domElement);
    } catch {
      /* ignore */
    }
    return null;
  }
}
