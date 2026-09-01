import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { beginUi, emptyUiInput } from "../im";
import { depthSelectScreen } from "./depth-select";
import { saveUnlockedDepth, clearUnlockedDepths } from "../../unlocked-depths";

function stubStorage(initial?: Record<string, string>): void {
  const store = new Map(Object.entries(initial ?? {}));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 40 }),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("depthSelectScreen", () => {
  beforeEach(() => {
    stubStorage();
    clearUnlockedDepths();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("creates screen and paints without error when depth 1 is unlocked", () => {
    const onSelect = vi.fn();
    const screen = depthSelectScreen({ onSelect });
    expect(screen.id).toBe("depth-select");

    const ctx = mockCtx();
    const frame = beginUi(ctx, 580, 360, emptyUiInput(), screen.focus, true, 1);
    screen.paint(frame, screen);
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it("paints multiple unlocked floors when higher depths are unlocked", () => {
    saveUnlockedDepth(8);
    const onSelect = vi.fn();
    const screen = depthSelectScreen({ onSelect });

    const ctx = mockCtx();
    const frame = beginUi(ctx, 580, 360, emptyUiInput(), screen.focus, true, 1);
    screen.paint(frame, screen);
    expect(frame.count).toBeGreaterThanOrEqual(8);
  });

  it("calls onSelect(1) when FLOOR 1 button is pressed", () => {
    saveUnlockedDepth(5);
    const onSelect = vi.fn();
    const screen = depthSelectScreen({ onSelect });

    const ctx = mockCtx();
    const input = {
      ...emptyUiInput(),
      pointer: { x: 50, y: 330, inside: true, down: true, pressed: true, released: false },
    };
    const frame = beginUi(ctx, 580, 360, input, screen.focus, true, 1);
    screen.paint(frame, screen);

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("calls onSelect with selected floor when DESCEND button is pressed", () => {
    saveUnlockedDepth(5);
    const onSelect = vi.fn();
    const screen = depthSelectScreen({ onSelect, initialFloor: 4 });

    const ctx = mockCtx();
    // Descend button is the middle button in footer (around x: 250, y: 330)
    const input = {
      ...emptyUiInput(),
      pointer: { x: 250, y: 330, inside: true, down: true, pressed: true, released: false },
    };
    const frame = beginUi(ctx, 580, 360, input, screen.focus, true, 1);
    screen.paint(frame, screen);

    expect(onSelect).toHaveBeenCalledWith(4);
  });
});
