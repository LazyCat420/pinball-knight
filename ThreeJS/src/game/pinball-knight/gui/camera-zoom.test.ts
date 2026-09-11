import { afterEach, describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { state } from "../state";
import { CAMERA_ZOOM_ORDER, CAMERA_ZOOMS, PPU } from "../constants";
import { getSettings, saveSettings } from "../settings-save";
import { applyCameraZoom } from "./apply-settings";

const previous = getSettings().cameraZoom;
afterEach(() => { state.camera = null; saveSettings({ cameraZoom: previous }); });

describe("live camera distance", () => {
  it("widens the projection at each zoom-out step without moving the camera", () => {
    const camera = state.camera = new OrthographicCamera(-640 / PPU, 640 / PPU, 360 / PPU, -360 / PPU, 0.1, 200);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    let previousX = Infinity;
    for (const cameraZoom of CAMERA_ZOOM_ORDER) {
      saveSettings({ cameraZoom });
      applyCameraZoom();
      const x = new Vector3(1, 0, 0).project(camera).x;
      expect(x).toBeLessThan(previousX);
      expect(x).toBeCloseTo(CAMERA_ZOOMS[cameraZoom] / 640);
      expect(camera.position.z).toBe(10);
      previousX = x;
    }
  });

  it("reapplies the chosen distance when a new run creates a camera", () => {
    saveSettings({ cameraZoom: "overview" });
    applyCameraZoom(); // Settings can be changed before a game is running.
    state.camera = new OrthographicCamera();
    applyCameraZoom();
    expect(state.camera.zoom).toBeCloseTo(24 / PPU);
    expect(getSettings().cameraZoom).toBe("overview");
  });
});
