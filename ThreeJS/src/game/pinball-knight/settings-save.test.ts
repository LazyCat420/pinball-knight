import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe("scenery pixel preference", () => {
  it.each([undefined, "invalid", 4, null])("uses Subtle for absent or invalid saved mode %s", async (pixelFilter) => {
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify({ pixelFilter, quantize: true, outline: true }) });
    const { getSettings } = await import("./settings-save");
    expect(getSettings()).toMatchObject({ pixelFilter: "subtle", quantize: false, outline: false });
  });
  it.each(["off", "subtle", "chunky"] as const)("persists %s across a reload", async (pixelFilter) => {
    let saved: string | null = null;
    vi.stubGlobal("localStorage", { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } });
    const { saveSettings } = await import("./settings-save");
    saveSettings({ pixelFilter });
    vi.resetModules();
    expect((await import("./settings-save")).getSettings().pixelFilter).toBe(pixelFilter);
  });
});
