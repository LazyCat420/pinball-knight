/**
 * The interaction model, tested without a canvas.
 *
 * These assert the two properties that the DOM menu got WRONG and that this
 * design exists to make impossible:
 *
 *  1. A widget's identity is its call order, so a click and a pad press address
 *     the SAME widget. The old menu addressed widgets by `data-act` suffix and
 *     `data-idx` attributes, and an empty `data-idx=""` shadowing the suffix is
 *     what made the skill tree "select everything then nothing" while failing
 *     silently (see menu.ts's `resolveAct` comment).
 *  2. One press activates one widget. An immediate-mode UI repaints every
 *     frame, so a level-triggered accept would fire on all of them.
 */
import { describe, it, expect, vi } from "vitest";
import {
  beginUi,
  beginScroll,
  clampFocus,
  cutTop,
  cutRight,
  emptyUiInput,
  exactIconSize,
  focusable,
  hit,
  inset,
  moveFocus,
  rect,
  scrollToShow,
  type UiInput,
} from "./im";

/**
 * A context stub. `focusable()` and the focus math never touch the canvas —
 * only the painting helpers do — so the interaction model is testable with no
 * DOM at all. That separation is deliberate: it is the part most likely to
 * break and the part hardest to eyeball in a screenshot.
 */
function ctx(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
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
}

function frame(input: UiInput, focus = 0) {
  return beginUi(ctx(), 1280, 720, input, focus, true);
}

describe("focusable", () => {
  it("numbers widgets by call order", () => {
    const f = frame(emptyUiInput());
    const a = focusable(f, rect(0, 0, 10, 10));
    const b = focusable(f, rect(0, 20, 10, 10));
    const c = focusable(f, rect(0, 40, 10, 10));
    expect([a.index, b.index, c.index]).toEqual([0, 1, 2]);
    expect(f.count).toBe(3);
  });

  it("activates exactly one widget per accept press", () => {
    const input = emptyUiInput();
    input.accept = true;
    const f = frame(input, 1);
    const a = focusable(f, rect(0, 0, 10, 10));
    const b = focusable(f, rect(0, 20, 10, 10));
    const c = focusable(f, rect(0, 40, 10, 10));
    expect([a.activated, b.activated, c.activated]).toEqual([false, true, false]);
  });

  it("does not let a second widget also consume the same press", () => {
    // The guard that matters: `f.consumed`. Without it, a screen whose focus
    // index exceeded its widget count (or two widgets sharing an index after a
    // layout change) could both fire from one press.
    const input = emptyUiInput();
    input.accept = true;
    const f = frame(input, 0);
    const a = focusable(f, rect(0, 0, 10, 10));
    expect(a.activated).toBe(true);
    expect(f.consumed).toBe(true);
    const b = focusable(f, rect(0, 20, 10, 10));
    expect(b.activated).toBe(false);
  });

  it("activates the widget the pointer clicked, whatever the focus was", () => {
    const input = emptyUiInput();
    input.pointer = { x: 5, y: 25, inside: true, down: true, pressed: true, released: false };
    const f = frame(input, 0);
    focusable(f, rect(0, 0, 10, 10));
    const b = focusable(f, rect(0, 20, 10, 10));
    expect(b.activated).toBe(true);
  });

  it("moves focus to a hovered widget ONLY when the pointer actually moved", () => {
    // A resting mouse that happens to sit over a row must not fight the D-pad
    // for the cursor — otherwise the highlight snaps back every frame and the
    // pad appears dead.
    const still = emptyUiInput();
    still.pointer = { x: 5, y: 25, inside: true, down: false, pressed: false, released: false };
    still.pointerMoved = false;
    const f1 = frame(still, 0);
    focusable(f1, rect(0, 0, 10, 10));
    focusable(f1, rect(0, 20, 10, 10));
    expect(f1.focus).toBe(0);

    const moved = emptyUiInput();
    moved.pointer = { x: 5, y: 25, inside: true, down: false, pressed: false, released: false };
    moved.pointerMoved = true;
    const f2 = frame(moved, 0);
    focusable(f2, rect(0, 0, 10, 10));
    focusable(f2, rect(0, 20, 10, 10));
    expect(f2.focus).toBe(1);
  });

  it("skips disabled widgets but still consumes their index", () => {
    // Index stability is the whole basis of identity here. If a disabled widget
    // did not take a slot, disabling one row would renumber every row after it
    // and the focus cursor would appear to jump — the immediate-mode version of
    // the shadowed data-idx.
    const input = emptyUiInput();
    input.accept = true;
    const f = frame(input, 1);
    focusable(f, rect(0, 0, 10, 10));
    const b = focusable(f, rect(0, 20, 10, 10), { disabled: true });
    const c = focusable(f, rect(0, 40, 10, 10));
    expect(b.index).toBe(1);
    expect(b.activated).toBe(false);
    expect(c.index).toBe(2);
  });
});

describe("focus movement", () => {
  it("wraps in both directions", () => {
    const f = frame(emptyUiInput(), 0);
    f.count = 4;
    expect(moveFocus(f, 1)).toBe(1);
    expect(moveFocus(f, -1)).toBe(3);
    f.focus = 3;
    expect(moveFocus(f, 1)).toBe(0);
  });

  it("survives an empty screen without dividing by zero", () => {
    const f = frame(emptyUiInput(), 0);
    f.count = 0;
    expect(moveFocus(f, 1)).toBe(0);
  });

  it("clamps a persisted cursor when the widget count shrinks", () => {
    // A stash emptying, a tab with fewer rows: the cursor must land somewhere
    // real rather than pointing past the end, where nothing would be focused
    // and the screen would look unresponsive.
    expect(clampFocus(9, 3)).toBe(2);
    expect(clampFocus(1, 3)).toBe(1);
    expect(clampFocus(5, 0)).toBe(0);
  });
});

describe("layout helpers", () => {
  it("cutTop takes from the top and shrinks the remainder", () => {
    const r = rect(10, 20, 100, 200);
    const top = cutTop(r, 30);
    expect(top).toEqual({ x: 10, y: 20, w: 100, h: 30 });
    expect(r).toEqual({ x: 10, y: 50, w: 100, h: 170 });
  });

  it("cutRight takes from the right edge", () => {
    const r = rect(0, 0, 100, 20);
    const knob = cutRight(r, 40);
    expect(knob).toEqual({ x: 60, y: 0, w: 40, h: 20 });
    expect(r.w).toBe(60);
  });

  it("hit test excludes the far edge so adjacent rows do not overlap", () => {
    const r = rect(0, 0, 10, 10);
    expect(hit(r, 0, 0)).toBe(true);
    expect(hit(r, 9.9, 9.9)).toBe(true);
    expect(hit(r, 10, 5)).toBe(false);
  });

  it("inset with a negative amount grows, for the focus ring", () => {
    expect(inset(rect(10, 10, 20, 20), -2)).toEqual({ x: 8, y: 8, w: 24, h: 24 });
  });
});

describe("scrollToShow", () => {
  const view = rect(0, 100, 200, 100); // a 100px window

  it("scrolls up when the focused widget is above the view", () => {
    expect(scrollToShow(view, rect(0, 100, 10, 20), 60)).toBeLessThan(60);
  });

  it("scrolls down when the focused widget is below the view", () => {
    // Widget at content-y 300 in a 100-tall view: must scroll past it.
    expect(scrollToShow(view, rect(0, 400, 10, 20), 0)).toBeGreaterThan(0);
  });

  it("leaves the offset alone when the widget is already visible", () => {
    expect(scrollToShow(view, rect(0, 150, 10, 20), 40)).toBe(40);
  });
});

/**
 * SCROLLING, which was two separate silent failures at once.
 *
 * Both were invisible from anywhere except a screenshot of a LONG list, and
 * neither threw, logged, or corrupted any state that a caller could inspect:
 * `offset` advanced correctly, the clamp behaved, and the scrollbar thumb slid
 * down its track the whole time.
 */
describe("beginScroll", () => {
  const view = rect(0, 100, 200, 100);

  it("lays content out at the view's origin, so the translate actually moves it", () => {
    // The first cut returned `r.y + offset` while translating the context by
    // `-offset`. That is an exact cancellation — every row lands back where it
    // started and the region never scrolls at all. Measured on the debug
    // console: `__gui().scroll` read 175 while two screenshots were identical.
    const f = frame(emptyUiInput());
    const { inner } = beginScroll(f, view, 1000, 40);
    expect(inner.y).toBe(view.y);
  });

  it("moves hit testing with the paint", () => {
    // A row at CONTENT y 380 is on screen at y 180 when the region is scrolled
    // by 200. Without `originY` the pointer (screen space) is compared against
    // the rect (content space) and every click lands `offset` pixels off —
    // which is what "the debug buttons do nothing" actually was.
    const input = emptyUiInput();
    input.pointer = { ...input.pointer, x: 10, y: 185, inside: true, pressed: true };
    const f = frame(input);
    beginScroll(f, view, 1000, 200);
    expect(focusable(f, rect(0, 380, 50, 20)).hovered).toBe(true);
  });

  it("does not answer for rows scrolled outside the view", () => {
    // Clipping hides them; without the clip rect they would still be clickable,
    // which is an invisible button sitting over the panel's own chrome.
    const input = emptyUiInput();
    input.pointer = { ...input.pointer, x: 10, y: 50, inside: true, pressed: true };
    const f = frame(input);
    beginScroll(f, view, 1000, 200);
    expect(focusable(f, rect(0, 250, 50, 20)).hovered).toBe(false);
  });
});

/**
 * Icon blits are integer-ratio or they are not blits — see `exactIconSize`.
 */
describe("exactIconSize", () => {
  it("snaps down to a divisor rather than resampling fractionally", () => {
    // 72/28 = 2.57: the ratio that deleted rows out of the shop icons.
    expect(exactIconSize(72, 28)).toBe(24);
    expect(exactIconSize(72, 20)).toBe(18);
    expect(exactIconSize(116, 60)).toBe(58);
  });

  it("is the identity when the art is already the size asked for", () => {
    expect(exactIconSize(16, 16)).toBe(16);
  });

  it("upscales only by whole multiples", () => {
    expect(exactIconSize(16, 33)).toBe(32);
  });

  it("never returns a size larger than the box", () => {
    for (const want of [7, 9, 11, 13, 17, 19, 23, 29, 31, 37, 41]) {
      expect(exactIconSize(72, want)).toBeLessThanOrEqual(want);
      expect(exactIconSize(72, want)).toBeGreaterThan(0);
    }
  });
});
