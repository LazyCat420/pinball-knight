/**
 * THE CAMERA SETTING HAS A ROUTE A PLAYER CAN WALK.
 *
 * This is a REACHABILITY test, and it exists because every other kind of test
 * passed while the control was unreachable. `settingsScreen()` was correct,
 * painted correctly, persisted correctly, and had five rungs with a reload
 * button — and no player could open it. Esc went to `menuScreen`, whose tab
 * strip had five tabs and none of them settings; `openMenuSettings()` was
 * exported and called by nothing for its whole life. The only route in was
 * `__gui.settings()` from the dev console. A screen with no caller is not a
 * feature, and nothing in the suite could tell the difference.
 *
 * So the assertions here are deliberately about the ROUTE and about being ON
 * SCREEN, not about the rows being right:
 *
 *   · Esc lands on the menu, and the menu's tab list contains OPTIONS.
 *   · Switching to it with the digit a player presses paints the camera control.
 *   · The camera control is in the FIRST screenful, so it does not need a scroll
 *     nobody knows to make — a row below the fold was the second half of the
 *     same complaint.
 *
 * node-canvas shims `document` because the tab strip's glyphs allocate.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createCanvas } from "canvas";
import { beginUi, emptyUiInput } from "../im";
import type { UiScreen } from "../stack";
import { CAMERA_ZOOM_ORDER } from "../../constants";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/** A context that remembers every string it was told to draw, and where. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; texts: Array<{ s: string; x: number; y: number }> } {
  const texts: Array<{ s: string; x: number; y: number }> = [];
  const ctx = {
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: (s: string, x: number, y: number) => void texts.push({ s, x, y }),
    // Wide enough to be realistic, narrow enough that nothing ellipsizes away
    // the label this test is looking for.
    measureText: (s: string) => ({ width: s.length * 8 }),
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
  return { ctx, texts };
}

/**
 * Paint the knight menu once per entry in `inputs`, carrying the screen's own
 * state across — which is what a real driver does, and what makes the digit
 * press take effect on the NEXT frame rather than the one that read it.
 */
async function paintMenu(inputs: Array<Partial<ReturnType<typeof emptyUiInput>>>) {
  const { menuScreen } = await import("./menu");
  const screen: UiScreen = menuScreen(() => {});
  const design = screen.design;
  expect(design).toBeDefined();
  let last = recordingCtx();
  for (const patch of inputs) {
    last = recordingCtx();
    const f = beginUi(last.ctx, design!.w, design!.h, { ...emptyUiInput(), ...patch }, screen.focus ?? 0, true);
    screen.paint(f, screen);
  }
  return last.texts;
}

describe("the camera setting is reachable from Esc", () => {
  it("Esc opens the menu — not a screen with no caller", async () => {
    // The route, asserted at the seam the player actually uses. `openMenu` is
    // what input/keymap.ts calls for both Esc and I.
    const menu = await import("./menu");
    expect(typeof menu.openMenu).toBe("function");
    // And the dead alternative is gone, so it cannot be mistaken for a route.
    expect("openMenuSettings" in menu).toBe(false);
  });

  it("offers OPTIONS in the tab strip", async () => {
    const texts = await paintMenu([{}]);
    expect(texts.map((t) => t.s)).toContain("OPTIONS");
  });

  it("advertises a digit range that covers OPTIONS", async () => {
    const texts = await paintMenu([{}]);
    const hint = texts.find((t) => t.s.includes("JUMP"));
    expect(hint).toBeDefined();
    // Derived from TABS.length, so a sixth tab cannot ship behind a "1-5" hint.
    expect(hint!.s).toContain("1-6 JUMP");
  });

  it("paints the camera control when the player presses 6", async () => {
    // Frame 1 reads the digit and commits the tab at the end of the paint;
    // frame 2 is the one the player sees. Both are real frames.
    const texts = await paintMenu([{ digit: 6 }, {}]);
    const labels = texts.map((t) => t.s);
    expect(labels).toContain("CAMERA");
    expect(labels).toContain("Camera distance");
    // The cycler carries the CURRENT rung as its face, so one of the five must
    // be on screen — this is the control, not just the heading.
    expect(labels.some((s) => CAMERA_ZOOM_ORDER.some((z) => s === z.toUpperCase()))).toBe(true);
  });

  it("puts it in the first screenful, so no scroll is needed to find it", async () => {
    const texts = await paintMenu([{ digit: 6 }, {}]);
    const at = (s: string): number => {
      const t = texts.find((x) => x.s === s);
      expect(t, `"${s}" was never painted`).toBeDefined();
      return t!.y;
    };
    // ORDERING, not an absolute y: these are frame coordinates and the sheet is
    // centred, so a hard bound here would be a bound on the sheet's margins.
    // Camera must be above every other section, which at scroll 0 is what puts
    // it on screen without one.
    const camera = at("Camera distance");
    for (const later of ["Sound FX", "Heat shimmer", "Floor haul screen"]) {
      expect(camera).toBeLessThan(at(later));
    }
    // …and above the footer, i.e. inside the visible sheet rather than clipped
    // off the bottom of the scroll view.
    const footer = texts.find((t) => t.s.includes("JUMP"));
    expect(footer).toBeDefined();
    expect(camera).toBeLessThan(footer!.y);
  });

  it("declares a scroll height that matches what it paints", async () => {
    const { settingsContentHeight } = await import("./settings");
    const texts = await paintMenu([{ digit: 6 }, {}]);
    const footerY = texts.find((t) => t.s.includes("JUMP"))!.y;
    const top = texts.find((t) => t.s === "CAMERA")!.y;
    // The body's own span, measured between its first label and its last —
    // origin-free, so it compares against the declared height rather than
    // against where the sheet happens to sit in the frame.
    const body = texts.filter((t) => t.y >= top && t.y < footerY);
    const span = Math.max(...body.map((t) => t.y)) - top;
    expect(span).toBeLessThan(settingsContentHeight());
    // Anti-vacuity: it really did paint the whole body, not just the heading.
    // Four headings, seven rows, two labels each, plus the cycler face.
    expect(body.length).toBeGreaterThan(12);
  });
});
