/**
 * THE DEATH SCREEN FITS THE BOX IT DECLARES.
 *
 * `UiScreen.design` is a promise made to the driver: it hands the screen the
 * largest whole zoom at which that box still fits the grid, and then gives it a
 * frame that can be exactly that box and no larger. Nothing checks that what
 * the screen PAINTS fits inside it — a screen that overflows still gets its
 * zoom, still paints, and simply loses the bottom of itself off the grid.
 *
 * That went from theoretical to one row away from real when the dead knight's
 * portrait was added: the block went from 248 of its 338 declared pixels to 336
 * of them. The comment over `design` says so; this is the part that stays true
 * when someone adds a line and does not read the comment.
 *
 * The frame is deliberately the SMALLEST the driver can hand this screen — a
 * frame exactly as tall as the design box — because that is the case the fixed
 * 380-tall column this screen used to lay out in got wrong and no bigger frame
 * would have shown.
 *
 * node-canvas shims `document` so `deadFace()` can allocate: the portrait is a
 * conditional row, and testing the layout without it is testing the layout that
 * is not shipping.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createCanvas } from "canvas";
import { beginUi, emptyUiInput } from "../im";
import type { UiScreen } from "../stack";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/**
 * A context that REMEMBERS where it was told to paint.
 *
 * `gui/im.test.ts`'s stub throws its coordinates away, which is right for the
 * interaction model and useless for geometry. Every primitive in `im.ts`
 * bottoms out in `fillRect` or `drawImage`, so recording those two is recording
 * the whole layout.
 */
function recordingCtx(): { ctx: CanvasRenderingContext2D; boxes: Array<[number, number, number, number]> } {
  const boxes: Array<[number, number, number, number]> = [];
  const ctx = {
    setTransform: vi.fn(),
    fillRect: (x: number, y: number, w: number, h: number) => void boxes.push([x, y, w, h]),
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => void boxes.push([x, y, w, h]),
    fillText: vi.fn(),
    measureText: () => ({ width: 40 }),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    translate: vi.fn(),
    imageSmoothingEnabled: false,
    textBaseline: "top",
    font: "",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
  return { ctx, boxes };
}

async function paintAtDesignSize(droppedCount?: number) {
  const { gameOverScreen } = await import("./game-over");
  const screen: UiScreen = gameOverScreen({
    onTavern: () => {},
    onRetry: () => {},
    onExit: () => {},
    ...(droppedCount === undefined ? {} : { droppedCount }),
  });
  const design = screen.design;
  expect(design).toBeDefined();
  const { ctx, boxes } = recordingCtx();
  const f = beginUi(ctx, design!.w, design!.h, emptyUiInput(), 0, true);
  screen.paint(f, screen);
  return { design: design!, boxes };
}

describe("the death screen fits its declared design box", () => {
  it.each([["with the drop notice", 3] as const, ["without it", undefined] as const])(
    "paints nothing below the bottom of the box — %s",
    async (_label, dropped) => {
      const { design, boxes } = await paintAtDesignSize(dropped);
      // The scrim is the whole frame by definition, so it is not an overflow.
      const inside = boxes.filter(([x, y, w, h]) => !(x === 0 && y === 0 && w === design.w && h === design.h));
      expect(inside.length).toBeGreaterThan(10); // anti-vacuity: it really painted
      const lowest = Math.max(...inside.map(([, y, , h]) => y + h));
      expect(lowest).toBeLessThanOrEqual(design.h);
    },
  );

  it("shows the portrait", async () => {
    const { boxes } = await paintAtDesignSize(3);
    const { FACE_PX } = await import("../../hud-face");
    // The face is the only thing on this screen drawn at its own native size,
    // and it must arrive at 1:1 — `drawIcon` snaps to a whole ratio, so a box
    // that stopped being a multiple of 72 would silently shrink the portrait
    // rather than fail.
    const blits = boxes.filter(([, , w, h]) => w === FACE_PX && h === FACE_PX);
    expect(blits.length).toBe(1);
  });
});
