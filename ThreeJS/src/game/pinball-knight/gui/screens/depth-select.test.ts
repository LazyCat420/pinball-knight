import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { beginUi, emptyUiInput } from "../im";
import { depthSelectScreen } from "./depth-select";
import { saveUnlockedDepth, clearUnlockedDepths } from "../../unlocked-depths";
import { paintFrame } from "./scroll-probe";

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

  it("scrolls down when mouse wheel is rolled inside the scroll region", () => {
    saveUnlockedDepth(8);
    const screen = depthSelectScreen({ onSelect: vi.fn(), initialFloor: 1 });
    const ctx = mockCtx();

    // Initial frame at top
    const f1 = beginUi(ctx, 580, 360, emptyUiInput(), screen.focus, true, 1);
    screen.paint(f1, screen);
    expect(screen.scroll).toBe(0);

    // Roll wheel down
    const wheelInput = {
      ...emptyUiInput(),
      scroll: 60,
      pointer: { x: 200, y: 150, inside: true, down: false, pressed: false, released: false, moved: false },
    };
    const f2 = beginUi(ctx, 580, 360, wheelInput, screen.focus, true, 1);
    screen.paint(f2, screen);
    expect(screen.scroll).toBeGreaterThan(0);
  });

  it("follows focus when navigating down through floors with arrow keys", () => {
    saveUnlockedDepth(9);
    const screen = depthSelectScreen({ onSelect: vi.fn(), initialFloor: 1 });
    const size = { w: 580, h: 360 };

    paintFrame(screen, size);

    // Step down to floor 8
    for (let i = 0; i < 8; i++) {
      const down = emptyUiInput();
      down.down = 1;
      paintFrame(screen, size, down);
      paintFrame(screen, size);
      paintFrame(screen, size);
    }
    expect(screen.scroll).toBeGreaterThan(0);
  });

  it("pre-scrolls and sets initial focus when resume floor is below the fold", () => {
    saveUnlockedDepth(8);
    const screen = depthSelectScreen({ onSelect: vi.fn(), initialFloor: 7 });
    expect(screen.focus).toBe(6); // Floor 7 is index 6
    expect(screen.scroll).toBeGreaterThan(0);
  });
});

