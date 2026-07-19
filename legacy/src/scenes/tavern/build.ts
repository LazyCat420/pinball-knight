/**
 * The room shell — floor, walls, hearth, and the stair back down.
 *
 * Material language (TAVERN_PLAN §Rules): blackened timber, wet stone, oxidised
 * brass and steel. Deliberately NOT a clean fantasy inn — this is a safehouse
 * built inside a machine, so the stone is cold and the only warmth is fire.
 *
 * Everything is box/plane primitives in the dungeon's palette. The pixel-pass
 * crush does the stylistic heavy lifting, so extra geometric detail mostly
 * disappears — silhouette and light colour are what read at this resolution.
 */
import * as THREE from "three";
import { PALETTE_HEX } from "../dungeon/render/palette";
import { ROOM, ROOM_W, ROOM_D, WALL_HEIGHT, STAIR, WARM } from "./layout";

/** Palette picks, by their index in the Cold Crypt ramp. */
const STONE_DK = PALETTE_HEX[1];
const STONE = PALETTE_HEX[2];
const TIMBER = PALETTE_HEX[26];
const TIMBER_DK = PALETTE_HEX[27] ?? PALETTE_HEX[26];
const FLAME = PALETTE_HEX[16];

/** Track every geometry/material so the scene can be torn down cleanly. */
export interface BuiltRoom {
  group: THREE.Group;
  /** The hearth light, driven by the flicker in core's loop. */
  fireLight: THREE.PointLight;
  /** Flame billboards, scaled per frame. */
  flames: THREE.Mesh[];
  dispose(): void;
}

export function buildRoom(scene: THREE.Scene): BuiltRoom {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const mat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05, ...opts });
    mats.push(m);
    return m;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const g = new THREE.BoxGeometry(w, h, d);
    geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // ── Floor ── plank timber, with a darker inlay marking the room's spine so
  // the eye is led from the stair to the notice board.
  const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_D);
  geos.push(floorGeo);
  const floorMat = mat(TIMBER_DK, { roughness: 1 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((ROOM.minX + ROOM.maxX) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const runnerGeo = new THREE.PlaneGeometry(3.2, ROOM_D - 1);
  geos.push(runnerGeo);
  const runner = new THREE.Mesh(runnerGeo, mat(STONE_DK, { roughness: 1 }));
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.01, 0);
  runner.receiveShadow = true;
  group.add(runner);

  // ── Walls ── only the two the fixed camera can actually see (north and west),
  // plus a low south rim so the room reads as enclosed without boxing in the view.
  const wallMat = mat(STONE, { roughness: 1 });
  box(ROOM_W + 1, WALL_HEIGHT, 0.5, wallMat, 0, WALL_HEIGHT / 2, ROOM.minZ - 0.25);
  box(0.5, WALL_HEIGHT, ROOM_D + 1, wallMat, ROOM.minX - 0.25, WALL_HEIGHT / 2, 0);
  // Near rims, knee-height so they never occlude the player.
  const rimMat = mat(STONE_DK, { roughness: 1 });
  box(ROOM_W + 1, 0.5, 0.5, rimMat, 0, 0.25, ROOM.maxZ + 0.25);
  box(0.5, 0.5, ROOM_D + 1, rimMat, ROOM.maxX + 0.25, 0.25, 0);

  // NO ceiling beams. They were built and then cut: under a FIXED iso camera a
  // beam at ceiling height projects as a wide black bar straight across the
  // middle of the frame, hiding the player and two stations behind it. Overhead
  // geometry and a locked camera angle don't mix — the "low, heavy roof" read
  // has to come from lighting falloff instead.

  // ── Hearth ── the room's warm anchor, set into the west wall.
  const hearthX = ROOM.minX + 0.5;
  box(1.0, 2.4, 3.0, mat(STONE, { roughness: 1 }), hearthX, 1.2, 0.2); // surround
  box(1.3, 0.24, 3.4, mat(TIMBER, { roughness: 1 }), hearthX, 2.5, 0.2); // mantel
  box(0.5, 1.4, 2.0, mat(0x120c08, { roughness: 1 }), hearthX + 0.35, 0.7, 0.2); // firebox

  const flames: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: FLAME, transparent: true, opacity: 0.85, depthWrite: false });
  mats.push(flameMat);
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.5, 0.8);
    geos.push(g);
    const f = new THREE.Mesh(g, flameMat);
    f.position.set(hearthX + 0.5, 0.45, 0.2 + (i - 1) * 0.55);
    f.rotation.y = Math.PI / 2;
    group.add(f);
    flames.push(f);
  }

  const fireLight = new THREE.PointLight(WARM, 9, 14, 2);
  fireLight.position.set(hearthX + 1.0, 1.5, 0.2);
  group.add(fireLight);

  // ── The way back down ── a stone stairwell at the south wall. Chained off:
  // the plunger gate at the notice board is the only way to descend, so this is
  // scenery that explains where you came from.
  const stairMat = mat(STONE_DK, { roughness: 1 });
  for (let i = 0; i < 4; i++) {
    box(STAIR.w, 0.22, 0.42, stairMat, STAIR.x, 0.11 - i * 0.14, STAIR.z + i * 0.34);
  }
  // A dark mouth behind it so the stair reads as going somewhere.
  const mouthGeo = new THREE.PlaneGeometry(STAIR.w, 1.6);
  geos.push(mouthGeo);
  const mouth = new THREE.Mesh(mouthGeo, new THREE.MeshBasicMaterial({ color: 0x05070b }));
  mats.push(mouth.material as THREE.Material);
  mouth.position.set(STAIR.x, 0.8, STAIR.z + 1.5);
  group.add(mouth);

  scene.add(group);

  return {
    group,
    fireLight,
    flames,
    dispose(): void {
      scene.remove(group);
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
