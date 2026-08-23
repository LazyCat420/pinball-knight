/**
 * EVERY VENDOR COUNTER IS REACHABLE WITHOUT A MOUSE.
 *
 * The counters are taller than the box they are painted in — measured, at the
 * design size: the Alchemist paints to y=380 in a 338-tall frame, and the card
 * dealer goes further still once a run has a stash. `beginScroll` advances only
 * from the mouse WHEEL, and only while the pointer is inside the region, so
 * without a screen scrolling to follow the focus cursor everything below the fold
 * was mouse-only: the D-pad walked the ring off the bottom, the highlight
 * vanished, and Enter fired a button that could not be seen.
 *
 * `im.ts`'s `scrollToShow` was written for that in the P0 foundation commit and
 * then called by nothing for five months — there was no way to get the focused
 * widget's rect to it, which is what `UiFrame.focusRect` now carries.
 *
 * ── WHAT THIS TEST MEASURES, AND WHY IT DOES NOT RE-DERIVE THE LAYOUT ──
 * The view rect and the applied scroll are read back out of the CONTEXT — the
 * clip rect `beginScroll` sets and the translate it applies — rather than
 * recomputed from the screen's own arithmetic. A second hand-kept copy of the
 * layout is how a scroll region silently stops matching what it scrolls (the
 * note over `settings.ts`'s content height says so), and it would let this test
 * agree with a broken screen.
 *
 * The focus loop mirrors `gui/root.ts`: paint, then `clampFocus`, then
 * `moveFocus` by the input delta. Twice per position, because the scroll the
 * paint computes lands on the NEXT frame — one paint proves nothing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createCanvas } from "canvas";
import { beginUi, clampFocus, emptyUiInput, type UiFrame } from "../im";
import type { UiScreen } from "../stack";
import { ROW_H } from "../theme";
import { state } from "../../state";
import { cardKey, cardsOfRarity } from "../../cards";
import type { VendorId } from "./tavern";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  // node-canvas shims `document` so the item/card art can allocate. Testing the
  // layout without the art is testing a layout that is not shipping.
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/**
 * A PURSE, because being broke hides the layout.
 *
 * Every price button greys out below its cost and a disabled row registers no
 * rect, so at the wallet's default 100g the Armorer has almost no focusable rows
 * and they all sit above the fold — the scroll assertions would pass vacuously
 * on the counter whose rows reach furthest down. A player standing at a vendor
 * has gold; that is the state worth testing.
 *
 * MOCKED rather than granted: the wallet persists through `localStorage`, which
 * this environment does not have, so `addGold` is a no-op here and the balance is
 * pinned at its default. Both `tavern.ts` and `economy/tavern-shop.ts` resolve to
 * this one module, so one mock covers the layout and the prices together.
 */
vi.mock("../../../../utils/gold-wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../utils/gold-wallet")>()),
  getBalance: () => 9000,
}));

interface Probe {
  ctx: CanvasRenderingContext2D;
  /** Rects handed to `clip()` — `beginScroll`'s view, in screen space. */
  clips: Array<{ x: number; y: number; w: number; h: number }>;
  /** Y translations applied; `beginScroll` uses `-shift`. */
  shifts: number[];
  /**
   * The bottom of the lowest thing painted INSIDE the scroll region, in content
   * space.
   *
   * Bounded by the clip/restore pair on purpose: the scrim and the scrollbar are
   * painted outside it, in SCREEN space, and averaging the two spaces together
   * would make the measurement meaningless.
   */
  regionBottom: number;
}

function probeCtx(): Probe {
  const clips: Probe["clips"] = [];
  const shifts: number[] = [];
  let pending: { x: number; y: number; w: number; h: number } | null = null;
  let inRegion = false;
  const probe: Probe = { ctx: null as unknown as CanvasRenderingContext2D, clips, shifts, regionBottom: 0 };
  const mark = (y: number, h: number): void => {
    if (inRegion) probe.regionBottom = Math.max(probe.regionBottom, y + h);
  };
  probe.ctx = {
    setTransform: vi.fn(),
    fillRect: (_x: number, y: number, _w: number, h: number) => mark(y, h),
    drawImage: (_i: unknown, _x: number, y: number, _w: number, h: number) => mark(y, h),
    fillText: vi.fn(),
    measureText: () => ({ width: 40 }),
    save: vi.fn(),
    restore: () => void (inRegion = false),
    beginPath: vi.fn(),
    rect: (x: number, y: number, w: number, h: number) => void (pending = { x, y, w, h }),
    clip: () => {
      if (pending) clips.push(pending);
      inRegion = true;
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

/** The design box the tavern declares — the frame the driver hands it. */
const DESIGN = { w: 600, h: 338 };

async function openCounter(vendor: VendorId): Promise<UiScreen> {
  // Imported in the test body, not at the top: the module graph pulls in the
  // item and card art, and `document` is only shimmed once `beforeAll` has run.
  const { tavernScreen } = await import("./tavern");
  return tavernScreen({
    onDescend: () => {},
    stats: { grade: "B", floor: 7, kills: 42, bestCombo: 6 },
    vendor,
    onClose: () => {},
  });
}

/** One driver frame. Returns the frame and what the context was told. */
function paint(screen: UiScreen, input = emptyUiInput()): { f: UiFrame; probe: Probe } {
  const probe = probeCtx();
  const f = beginUi(probe.ctx, DESIGN.w, DESIGN.h, input, screen.focus, true);
  screen.paint(f, screen);
  screen.focus = clampFocus(f.focus, f.count);
  return { f, probe };
}

const VENDORS: VendorId[] = ["potions", "cards", "weapons", "armor"];

describe("the vendor counters", () => {
  it.each(VENDORS)("paints without throwing — %s", async (vendor) => {
    // Anti-vacuity for everything below: a counter that throws would also
    // "never scroll off screen".
    const screen = await openCounter(vendor);
    expect(() => paint(screen)).not.toThrow();
    expect(paint(screen).f.count).toBeGreaterThan(1);
  });

  it.each(VENDORS)("keeps the focused row on screen at every cursor position — %s", async (vendor) => {
    const screen = await openCounter(vendor);
    const total = paint(screen).f.count;
    expect(total).toBeGreaterThan(1);

    let sawBelowTheFold = false;
    let checked = 0;
    for (let i = 0; i < total; i++) {
      screen.focus = i;
      // Twice: the scroll a paint computes is applied by the NEXT paint.
      paint(screen);
      const { f, probe } = paint(screen);
      // A disabled row registers no rect — and `moveFocus` no longer lets the
      // cursor stop on one, so there is nothing to scroll to.
      if (!f.focusRect) continue;
      const view = probe.clips[0];
      const shift = probe.shifts[0] ?? 0;
      expect(view).toBeDefined();
      // The "← TAVERN" button is CHROME: `cutTop(view, 26)` takes its strip
      // before `beginScroll` ever runs, so it sits above the region and is
      // always visible by construction. Skipping it is not skipping a case — a
      // region row that failed to scroll into view is still below `view.y`.
      if (f.focusRect.y < view.y) continue;

      // The band of CONTENT the view is showing — `beginScroll`'s own `f.clip`.
      const bandTop = view.y + shift;
      const bandBottom = bandTop + view.h;
      expect(f.focusRect.y).toBeGreaterThanOrEqual(bandTop);
      expect(f.focusRect.y + f.focusRect.h).toBeLessThanOrEqual(bandBottom);
      checked++;
      if (shift > 0) sawBelowTheFold = true;
    }
    expect(checked).toBeGreaterThan(1);
    // THE POINT. If nothing ever needed scrolling, the assertions above passed
    // for free and this test would go on passing after the fix was reverted.
    expect(sawBelowTheFold).toBe(true);
  });
});

describe("the declared scroll height", () => {
  /** Wheel input, with the pointer parked inside the region. */
  function wheelDown(): ReturnType<typeof emptyUiInput> {
    const input = emptyUiInput();
    input.pointer = { x: 300, y: 200, inside: true, down: false, pressed: false, released: false };
    input.scroll = 400;
    return input;
  }

  it.each(VENDORS)("matches what the counter paints, so there is no void below it — %s", async (vendor) => {
    // `vendorHeight()` was a hand-written formula per vendor and it did not match
    // the bodies. The Alchemist's summed BOTH tabs — 938px declared for a ~284px
    // shelf — so scrolling ran 650px past the last row into nothing, with a
    // scrollbar thumb sized for content that was not there.
    const screen = await openCounter(vendor);
    // Saturate: several frames of wheel, so the offset reaches its clamp.
    for (let i = 0; i < 8; i++) paint(screen, wheelDown());
    const { probe } = paint(screen, wheelDown());
    const view = probe.clips[0];
    const shift = probe.shifts[0] ?? 0;

    // What the region CAN scroll, versus what it actually has to show.
    const declared = shift + view.h;
    const painted = probe.regionBottom - view.y;
    expect(painted).toBeGreaterThan(0);
    // One row of slack for the tail padding; a formula that double-counts a tab
    // or forgets a section misses by hundreds.
    expect(declared).toBeLessThanOrEqual(painted + ROW_H * 2);
  });
});

describe("the card dealer with a real stash", () => {
  it("still reaches its last row once the stash has grown", async () => {
    // The dealer's height is a function of the stash, so an empty run tests the
    // shortest possible version of the one counter that grows without bound.
    const stash = state.cardStash;
    // A real base from the roster — `cardDef` must know it or the faces and the
    // rarity lookups silently fall back.
    state.cardStash = Array.from({ length: 14 }, () => cardKey(cardsOfRarity("common")[0], 1, false));
    try {
      const screen = await openCounter("cards");
      const total = paint(screen).f.count;

      // The DEEPEST row that can actually hold the cursor. Not `total - 1`: the
      // last widgets are FORGE and REROLL PICKED, both disabled until something
      // is picked, and a disabled index is no longer somewhere the cursor stops.
      let deepest = -1;
      for (let i = 0; i < total; i++) {
        screen.focus = i;
        paint(screen);
        if (paint(screen).f.focusRect) deepest = i;
      }
      expect(deepest).toBeGreaterThan(0);

      screen.focus = deepest;
      paint(screen);
      const { f, probe } = paint(screen);
      const view = probe.clips[0];
      const shift = probe.shifts[0] ?? 0;
      // A 14-card stash is far taller than the view, so reaching its last row
      // REQUIRES the region to have scrolled — this is the assertion that fails
      // if `scrollToShow` stops being called.
      expect(shift).toBeGreaterThan(0);
      expect(f.focusRect).not.toBeNull();
      expect(f.focusRect!.y + f.focusRect!.h).toBeLessThanOrEqual(view.y + shift + view.h);
    } finally {
      state.cardStash = stash;
    }
  });
});
