import { describe, it, expect } from "vitest";
import { isRendererReady, gpuTimingWanted } from "./renderer";

describe("Native WebGPU Pinball Knight Renderer (Sub-Phase 7D)", () => {
  it("provides gpuTimingWanted helper", () => {
    expect(typeof gpuTimingWanted()).toBe("boolean");
  });

  it("isRendererReady returns status boolean", () => {
    expect(typeof isRendererReady()).toBe("boolean");
  });
});
