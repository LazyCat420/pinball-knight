import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("a held intro-skip key entering the character selector", () => {
  it.each(["Escape", "Enter", " "])("requires a fresh press after %s is released", async (key) => {
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("window", { addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn) });
    vi.stubGlobal("navigator", { getGamepads: () => [] });
    const input = await import("./input");
    input.installUiInput();
    const event = (repeat: boolean) => ({ key, repeat, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    const read = () => input.takeFrame({ renderW: 640, renderH: 360, scale: 1, outW: 640, outH: 360, cssScale: 1 }, 640, 360, 0);
    // Intro owns the original key press; the UI opens while it remains held.
    listeners.get("keydown")!(event(false));
    input.setUiInputLive(true);
    listeners.get("keydown")!(event(true));
    expect(read()).toMatchObject({ accept: false, cancel: false });
    listeners.get("keydown")!(event(true));
    expect(read()).toMatchObject({ accept: false, cancel: false });
    listeners.get("keyup")!(event(false));
    listeners.get("keydown")!(event(false));
    expect(read()).toMatchObject({ accept: key !== "Escape", cancel: key === "Escape" });
    expect(read()).toMatchObject({ accept: false, cancel: false });
  });
});
