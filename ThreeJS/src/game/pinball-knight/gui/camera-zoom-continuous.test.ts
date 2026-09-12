/**
 * Continuous camera zoom — the scroll wheel, the slider, and the atlas floor.
 *
 * The seven named rungs are presets on a line now rather than the only stops.
 * What these pin is the LINE's properties, not any particular number on it, so
 * retuning the ends or the step does not make the suite red for having been
 * retuned: every assertion is derived from CAMERA_PPU_MIN/MAX/STEP.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { state } from "../state";
import {
  CAMERA_PPU_MAX,
  CAMERA_PPU_MIN,
  CAMERA_ZOOMS,
  CAMERA_ZOOM_DEFAULT,
  CAMERA_ZOOM_STEP,
  PPU,
  atlasPpuFor,
  clampCameraPpu,
} from "../constants";
import { getSettings, saveSettings } from "../settings-save";
import { applyCameraZoom, cameraZoomFraction, nudgeCameraZoom, setCameraZoomFraction } from "./apply-settings";

const previousPpu = getSettings().cameraPpu;
const previousRung = getSettings().cameraZoom;

afterEach(() => {
  state.camera = null;
  saveSettings({ cameraZoom: previousRung, cameraPpu: previousPpu });
});

function freshCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-640 / PPU, 640 / PPU, 360 / PPU, -360 / PPU, 0.1, 200);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  state.camera = camera;
  return camera;
}

describe("the zoom is a continuous line, not seven rungs", () => {
  it("reaches framings no rung could express", () => {
    // The complaint this feature exists for: the gap between `wide` (54) and
    // `wider` (46) is the widest step in the playable half, so the framing most
    // wanted was the one the ladder could not produce.
    const between = (CAMERA_ZOOMS.wide + CAMERA_ZOOMS.wider) / 2;
    expect(Object.values(CAMERA_ZOOMS)).not.toContain(between);
    saveSettings({ cameraPpu: between });
    const camera = freshCamera();
    applyCameraZoom();
    expect(camera.zoom).toBeCloseTo(between / PPU, 6);
  });

  it("clamps to the range from either side, and survives a poisoned blob", () => {
    expect(clampCameraPpu(CAMERA_PPU_MAX + 500)).toBe(CAMERA_PPU_MAX);
    expect(clampCameraPpu(CAMERA_PPU_MIN - 500)).toBe(CAMERA_PPU_MIN);
    // NaN must not reach camera.zoom: a non-finite projection matrix is a black
    // screen, not a wrong framing.
    expect(Number.isFinite(clampCameraPpu(NaN))).toBe(true);
    expect(Number.isFinite(clampCameraPpu(0))).toBe(true);
  });

  it("never lets a stored value put a non-finite number on the camera", () => {
    saveSettings({ cameraPpu: Number.NaN });
    const camera = freshCamera();
    applyCameraZoom();
    expect(Number.isFinite(camera.zoom)).toBe(true);
    expect(camera.zoom).toBeGreaterThan(0);
  });
});

describe("the wheel", () => {
  it("is multiplicative, so a notch is the same perceived change at both ends", () => {
    saveSettings({ cameraPpu: 30 });
    const atFar = nudgeCameraZoom(1) / 30;
    saveSettings({ cameraPpu: 60 });
    const atNear = nudgeCameraZoom(1) / 60;
    // An ADDITIVE step would make these differ by 2x across this range, which
    // reads as the wheel speeding up as you zoom out.
    expect(atFar).toBeCloseTo(atNear, 4);
    expect(atFar).toBeCloseTo(CAMERA_ZOOM_STEP, 3);
  });

  it("round-trips: in then out returns to where it started", () => {
    saveSettings({ cameraPpu: 46 });
    nudgeCameraZoom(1);
    nudgeCameraZoom(-1);
    expect(getSettings().cameraPpu).toBeCloseTo(46, 1);
  });

  it("stops at the ends instead of wrapping to the other one", () => {
    saveSettings({ cameraPpu: CAMERA_PPU_MAX });
    expect(nudgeCameraZoom(5)).toBe(CAMERA_PPU_MAX);
    saveSettings({ cameraPpu: CAMERA_PPU_MIN });
    expect(nudgeCameraZoom(-5)).toBe(CAMERA_PPU_MIN);
  });

  it("applies to the live camera without a reload", () => {
    saveSettings({ cameraPpu: 46 });
    const camera = freshCamera();
    applyCameraZoom();
    const before = camera.zoom;
    nudgeCameraZoom(3);
    expect(camera.zoom).toBeGreaterThan(before);
    expect(camera.position.z, "zoom must not dolly the camera").toBe(10);
  });
});

describe("the slider", () => {
  it("maps 0..1 onto the whole range, ends included", () => {
    setCameraZoomFraction(0);
    expect(getSettings().cameraPpu).toBeCloseTo(CAMERA_PPU_MIN, 1);
    setCameraZoomFraction(1);
    expect(getSettings().cameraPpu).toBeCloseTo(CAMERA_PPU_MAX, 1);
  });

  it("round-trips through the fraction it reports", () => {
    for (const ppu of [CAMERA_PPU_MIN, 40, 46, 55, CAMERA_PPU_MAX]) {
      saveSettings({ cameraPpu: ppu });
      const back = cameraZoomFraction();
      setCameraZoomFraction(back);
      expect(getSettings().cameraPpu).toBeCloseTo(ppu, 1);
    }
  });
});

describe("a named rung still moves the camera", () => {
  it("writes through to the continuous value", () => {
    // Presets went dead the moment framing stopped reading `cameraZoom`: the
    // rung was still stored and still named a distance, but nothing consulted
    // it, so picking one changed a label and left the camera put.
    saveSettings({ cameraZoom: "overview" });
    expect(getSettings().cameraPpu).toBe(CAMERA_ZOOMS.overview);
    saveSettings({ cameraZoom: "close" });
    expect(getSettings().cameraPpu).toBe(CAMERA_ZOOMS.close);
  });

  it("lets an explicit pair through untouched", () => {
    saveSettings({ cameraZoom: "close", cameraPpu: 33 });
    expect(getSettings().cameraPpu).toBe(33);
  });
});

describe("the atlas resolution", () => {
  it("is always even, or the sprite pixel identity stops holding", () => {
    // SPRITE_PIXEL_GRID = SPRITE_UNITS(3/2) x PPU must be a whole texel count.
    for (let ppu = CAMERA_PPU_MIN; ppu <= CAMERA_PPU_MAX; ppu += 0.5) {
      const atlas = atlasPpuFor(ppu);
      expect(atlas % 2, `atlasPpuFor(${ppu}) must be even`).toBe(0);
      expect(((atlas * 3) / 2) % 1, `grid for ${ppu} must be whole texels`).toBe(0);
    }
  });

  it("NEVER drops below the default, however far out the player zooms", () => {
    // The bug this is here to stop: following the zoom down bakes sprites at 24
    // PPU (36 texels instead of 69), so zooming out would permanently destroy
    // the detail it was already short of and the NEXT launch would look worse
    // than the session that chose it.
    const floor = CAMERA_ZOOMS[CAMERA_ZOOM_DEFAULT];
    for (const ppu of [CAMERA_PPU_MIN, 30, 36, 40, 45]) {
      expect(atlasPpuFor(ppu), `zooming out to ${ppu} must not shrink the atlas`).toBe(floor);
    }
  });

  it("does follow the zoom upward, so the close end is baked not upscaled", () => {
    expect(atlasPpuFor(CAMERA_PPU_MAX)).toBeGreaterThan(CAMERA_ZOOMS[CAMERA_ZOOM_DEFAULT]);
    expect(atlasPpuFor(CAMERA_PPU_MAX)).toBe(CAMERA_PPU_MAX);
    expect(atlasPpuFor(60)).toBe(60);
  });
});
