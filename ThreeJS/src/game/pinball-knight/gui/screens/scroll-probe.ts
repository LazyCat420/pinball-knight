/**
 * TEST SCAFFOLDING — a 2D context that reports the geometry it was handed.
 *
 * Not imported by anything that ships; it lives here rather than inside one
 * `.test.ts` because two suites need it and the thing it must not get wrong is
 * subtle enough to be worth having exactly once.
 *
 * ── THE RULE IT ENCODES ──
 * A scroll region's view rect and its applied offset are read back out of the
 * CONTEXT — the rect handed to `clip()` and the `translate()` that follows —
 * never recomputed from the screen's own arithmetic. A test that re-derives the
 * layout is a second hand-kept copy of it, which is precisely how a scroll region
 * silently stops matching what it scrolls (see the note over
 * `settingsContentHeight`). Re-deriving would also let the test agree with a
 * broken screen: both halves would be wrong in the same direction.
 *
 * `measureText` returns a fixed width, so this probe is for LAYOUT, not for text
 * fitting. Anything that depends on real glyph advance needs node-canvas.
 */
import type { Rect, UiFrame } from "../im";
import { beginUi, clampFocus, emptyUiInput, moveFocus, type UiInput } from "../im";
import type { UiScreen } from "../stack";

export interface ScrollProbe {
  ctx: CanvasRenderingContext2D;
  /** Rects passed to `clip()`, in screen space — `beginScroll`'s view, in order. */
  clips: Rect[];
  /** Y offsets applied by `translate()`, sign-flipped to the scroll they mean. */
  shifts: number[];
  /** Bottom of the lowest thing painted INSIDE a clip, in content space. */
  regionBottom: number;
}

/**
 * `regionBottom` is bounded by the clip/restore pair deliberately: the scrim and
 * the scrollbar are painted OUTSIDE it in screen space, and letting the two
 * coordinate systems into one maximum makes the number meaningless.
 */
export function scrollProbe(): ScrollProbe {
  const clips: Rect[] = [];
  const shifts: number[] = [];
  let pending: Rect | null = null;
  let depth = 0;
  const probe: ScrollProbe = {
    ctx: null as unknown as CanvasRenderingContext2D,
    clips,
    shifts,
    regionBottom: 0,
  };
  const mark = (y: number, h: number): void => {
    if (depth > 0) probe.regionBottom = Math.max(probe.regionBottom, y + h);
  };
  probe.ctx = {
    setTransform: () => {},
    fillRect: (_x: number, y: number, _w: number, h: number) => mark(y, h),
    drawImage: (_i: unknown, _x: number, y: number, _w: number, h: number) => mark(y, h),
    fillText: () => {},
    measureText: () => ({ width: 40 }),
    save: () => {},
    restore: () => void (depth = Math.max(0, depth - 1)),
    beginPath: () => {},
    rect: (x: number, y: number, w: number, h: number) => void (pending = { x, y, w, h }),
    clip: () => {
      if (pending) clips.push(pending);
      depth++;
    },
    translate: (_x: number, y: number) => void shifts.push(-y),
    imageSmoothingEnabled: false,
    textBaseline: "top",
    font: "",
    fillStyle: "",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return probe;
}

/**
 * One driver frame, in the order `gui/root.ts` does it: paint, clamp, then move
 * the cursor by the input delta. Getting that order wrong would test a focus
 * model the game does not have.
 */
export function paintFrame(
  screen: UiScreen,
  size: { w: number; h: number },
  input: UiInput = emptyUiInput(),
): { f: UiFrame; probe: ScrollProbe } {
  const probe = scrollProbe();
  const f = beginUi(probe.ctx, size.w, size.h, input, screen.focus, true);
  screen.paint(f, screen);
  screen.focus = clampFocus(f.focus, f.count);
  screen.focus = moveFocus(f, input.down - input.up);
  return { f, probe };
}

/** The frame the driver hands a screen: its design box, or a desktop grid. */
export function frameFor(screen: UiScreen): { w: number; h: number } {
  return screen.design ? { w: screen.design.w, h: screen.design.h } : { w: 800, h: 450 };
}
