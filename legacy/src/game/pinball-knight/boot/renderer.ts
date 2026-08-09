/**
 * The renderer and the pixel pass — Native WebGPU edition.
 */
import { WebGPUDevice } from "../../../webgpu/core/device";
import { state } from "../state";
import { createPixelPass } from "../engine/render/pixel-pass";
import { BLOOM_DEFAULT, AO_DEFAULT, CEL_DEFAULT } from "../constants";
import { uiTexture, syncSize } from "../gui/layer";
import { installUiInput } from "../gui/input";
import { drawUiFrame } from "../gui/root";

export function gpuTimingWanted(): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(window.location.search);
  return q.get("profile") === "1" || q.get("playtest") === "1";
}

let rendererReady = false;

export function isRendererReady(): boolean {
  return rendererReady;
}

export function presentUiFrame(): boolean {
  if (!rendererReady || !state.pixelPass) return false;
  state.pixelPass.presentUi();
  return true;
}

export function installRenderer(): void {
  rendererReady = true;

  const pass = createPixelPass(state.renderer || ({} as any), {
    quantize: state.quantize,
    dither: state.dither,
    scanline: state.scanline,
    outline: state.outline,
    bloom: BLOOM_DEFAULT,
    ao: AO_DEFAULT,
    cel: CEL_DEFAULT,
    uiTexture: uiTexture(),
  });

  syncSize(pass.sizing());
  installUiInput();

  const renderScene = pass.render.bind(pass);
  pass.render = (scene, camera) => {
    drawUiFrame(pass);
    renderScene(scene, camera);
  };

  const presentUiOnly = pass.presentUi.bind(pass);
  pass.presentUi = () => {
    drawUiFrame(pass);
    presentUiOnly();
  };

  state.pixelPass = pass;
}
