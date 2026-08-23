/**
 * The scene graph: scene, fog, lights, VFX, the aim decal, the camera and the
 * monster atlases.
 *
 * Extracted verbatim from `launchDungeonGame`. These were six consecutive
 * banner-comment sections that all did the same kind of thing — construct a
 * long-lived object and hang it on `state` — so they travel together rather
 * than as six near-empty files.
 *
 * Ordering inside is load-bearing: `state.scene` must exist before `createVfx`
 * and before the aim indicator is added to it.
 */
import * as THREE from "three";
import { state } from "../state";
import { createVfx } from "../fx/system";
import { createAimIndicator } from "../render/aim-indicator";
import { createDungeonCamera, aimCamera } from "../engine/camera";
import { buildLights } from "./lighting";
import { buildMonsterSheets } from "./sheets";
import { BIOMES } from "./biomes";
import { PALETTE_HEX } from "../render/palette";
import { FOG_NEAR, FOG_FAR } from "../constants";

/** Build the scene and everything that lives in it for the whole session. */
export function installScene(): void {
  // ── Scene ──
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(PALETTE_HEX[0]);
  // Far (upper) corridors fade into the void — see FOG_NEAR/FOG_FAR.
  state.scene.fog = new THREE.Fog(PALETTE_HEX[0], FOG_NEAR, FOG_FAR);

  // The lighting rig (ambient/hemi/lamp/key + shadow config) — boot/lighting.ts.
  buildLights(BIOMES[0]);

  // ── VFX (sparks / blood / embers / dust / slashes) ──
  // Lives for the whole session (not per level); drawn into the scene so it
  // gets pixelated, quantized and bloomed with everything else.
  state.vfx = createVfx(state.scene);

  // ── Pinball aim indicator ──
  // Ground decal showing heading vs steer while rolling; hidden otherwise, so
  // it costs nothing visually outside ball form.
  state.aimIndicator = createAimIndicator();
  state.scene.add(state.aimIndicator.group);

  // ── Camera ──
  state.camera = createDungeonCamera();
  aimCamera(state.camera, 0, 0.5, 0);

  // ── Sprite sheets ── boot/sheets.ts builds every monster atlas.
  buildMonsterSheets();
}
