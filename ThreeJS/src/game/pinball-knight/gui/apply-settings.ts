/**
 * Push the persisted settings onto the live systems.
 *
 * Moved out of `menu.ts` when that file was deleted. It never belonged to the
 * menu: the menu was simply the only thing that called it, and the DOM sheet
 * happened to be where it was typed. It is the bridge between
 * `settings-save.ts` (what the player chose, persisted) and the systems those
 * choices drive — the sfx gate and the pixel pass — and every one of its
 * callers is now something other than a menu (boot, the settings screen).
 */
import { CAMERA_PPU_MAX, CAMERA_PPU_MIN, CAMERA_ZOOM_STEP, PPU, clampCameraPpu } from "../constants";
import { state } from "../state";
import { getSettings, saveSettings } from "../settings-save";
import { setSfxMuted, setSfxVolume } from "../sfx";

/**
 * Match the selected field of view without rebuilding the boot-time atlases.
 *
 * `PPU` is the BOOT atlas resolution and never moves within a session; the
 * ratio below is therefore "how much bigger than its baked size each sprite is
 * being drawn". At 1.0 one atlas texel is one screen pixel — the pixel identity
 * `SPRITE_UNITS * PPU === SPRITE_PIXEL_GRID` exists to hold. Off 1.0 it does
 * not, which is what `setZoomRatio` on the pixel pass is told about so the
 * sampler can compensate instead of aliasing. See docs/camera-zoom.md.
 */
export function applyCameraZoom(): void {
  const camera = state.camera;
  if (!camera) return;
  const ratio = clampCameraPpu(getSettings().cameraPpu) / PPU;
  camera.zoom = ratio;
  camera.updateProjectionMatrix();
  // The scenery pixel block is a SCREEN-space size, so without this it covers
  // more world the further you zoom out — the scenery got chunkier exactly when
  // there was least detail to spare. Telling the pass the ratio lets it hold
  // the block constant in WORLD terms instead.
  state.pixelPass?.setZoomRatio(ratio);
}

/**
 * Nudge the zoom by `notches` (positive = zoom IN), persist, and apply.
 *
 * Multiplicative rather than additive so a notch is the same PERCEIVED change
 * at both ends — an additive step of 2 PPU is 3% at the close end and 8% at the
 * far end, which reads as the wheel speeding up as you zoom out.
 *
 * Returns the PPU it settled on, so a caller can tell "moved" from "already at
 * the stop" without re-reading settings.
 */
export function nudgeCameraZoom(notches: number): number {
  const current = clampCameraPpu(getSettings().cameraPpu);
  const next = clampCameraPpu(current * Math.pow(CAMERA_ZOOM_STEP, notches));
  // Round to 2dp: the wheel would otherwise write a new float to localStorage on
  // every notch forever, and a slider that reads back 45.999999 cannot show a
  // stable label.
  const settled = Math.round(next * 100) / 100;
  if (settled !== current) {
    saveSettings({ cameraPpu: settled });
    applyCameraZoom();
  }
  return settled;
}

/** The zoom as a 0..1 position on the continuous range — for the slider. */
export function cameraZoomFraction(): number {
  const ppu = clampCameraPpu(getSettings().cameraPpu);
  return (ppu - CAMERA_PPU_MIN) / (CAMERA_PPU_MAX - CAMERA_PPU_MIN);
}

/** Set the zoom from a 0..1 slider position, persist, and apply. */
export function setCameraZoomFraction(t: number): void {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const ppu = CAMERA_PPU_MIN + clamped * (CAMERA_PPU_MAX - CAMERA_PPU_MIN);
  saveSettings({ cameraPpu: Math.round(ppu * 100) / 100 });
  applyCameraZoom();
}

export function applySettingsLive(): void {
  applyCameraZoom();
  const s = getSettings();
  setSfxMuted(s.muted);
  // Independent of the mute, on purpose: un-muting restores the level the player
  // chose rather than jumping to full. Both are pushed on every call so a boot
  // with a persisted volume is at the right level before the first sting.
  setSfxVolume(s.volume);
  state.quantize = s.quantize;
  state.dither = s.dither;
  state.scanline = s.scanline;
  state.outline = s.outline;
  state.pixelPass?.setPixelFilter(s.pixelFilter);
  state.pixelPass?.setQuantize(s.quantize);
  state.pixelPass?.setDither(s.dither);
  state.pixelPass?.setScanline(s.scanline);
  state.pixelPass?.setOutline(s.outline);
  state.pixelPass?.setHeatEnabled(s.heatShimmer);
}
