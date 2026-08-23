/**
 * THE KNIGHT MENU'S SCROLL REGION MATCHES WHAT ITS TABS PAINT.
 *
 * `contentHeight(tab)` was a hand-written formula per tab and it disagreed with
 * the bodies on FIVE OF SIX. Measured on a fresh run before the fix: bestiary
 * declared 1482 against 818 painted, stats 494 against 187, cards 324 against
 * 147, skills 855 against 808, gear 337 against 297. The player's symptom is the
 * tavern's old `vendorHeight()` bug — the region scrolls hundreds of pixels past
 * the last row into nothing, with a scrollbar thumb sized for content that is not
 * there. The fix measures how far `cutTop` walked the body instead.
 *
 * ── THE TWO ASSERTIONS ARE A PAIR, AND NEITHER ALONE IS THE PROPERTY ──
 *   · REACH: the region can scroll far enough to show the lowest thing painted.
 *     An under-declared height fails here — which is the failure mode the
 *     measurement INTRODUCES, because a tab that paints an absolute grid without
 *     cutting past it (`cardsTab`'s stash) leaves the cursor above its own
 *     content and strands the last row.
 *   · NO VOID: it can scroll no FURTHER than that. The over-declared formula
 *     failed here and passed REACH comfortably, which is why a one-sided test
 *     would have gone on agreeing with the bug.
 *
 * Both are read out of the CONTEXT — the clip rect `beginScroll` sets and the
 * translate it applies — rather than recomputed from the screen's own
 * arithmetic. A second hand-kept copy of the layout is the thing under test.
 *
 * Tabs are entered by the DIGIT a player presses, and the state is seeded to
 * both ends: a fresh run is the low end of the two state-dependent tabs (cards,
 * bestiary), so the rich case is the one that was never verified.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createCanvas } from "canvas";
import { beginUi, clampFocus, emptyUiInput, type UiFrame } from "../im";
import type { UiScreen } from "../stack";
import { ROW_H } from "../theme";
import { state } from "../../state";
import { cardKey, cardsOfRarity } from "../../cards";
import { KIND_IDS } from "../../bestiary";
import { REAGENT_IDS } from "../../reagents";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  // node-canvas shims `document` so the item, card and portrait art can
  // allocate. Testing the layout without the art is testing a layout that is
  // not shipping.
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

/** See `tavern.test.ts` — the wallet persists through an absent `localStorage`. */
vi.mock("../../../../utils/gold-wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../utils/gold-wallet")>()),
  getBalance: () => 9000,
}));

interface Probe {
  ctx: CanvasRenderingContext2D;
  /** Rects handed to `clip()`. Only `beginScroll` clips, so [0] is the region. */
  clips: Array<{ x: number; y: number; w: number; h: number }>;
  /** Y translations applied; `beginScroll` uses `-shift`. */
  shifts: number[];
  /**
   * The bottom of the lowest thing painted INSIDE the region, in content space.
   * Bounded by the clip/restore pair: the scrim, tab strip and scrollbar are
   * painted outside it in SCREEN space, and mixing the two spaces would make the
   * number meaningless.
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
    // Text marks too: the bestiary's drop lines and the stats rows are text under
    // a well, and a tab whose LAST element is a line of text (the empty-stash and
    // empty-pouch notices) would otherwise measure as painting nothing there.
    fillText: (_s: string, _x: number, y: number) => mark(y, 8),
    // Realistic enough that `wrap()` breaks lines rather than looping, narrow
    // enough that nothing ellipsizes into a shorter body than ships.
    measureText: (s: string) => ({ width: s.length * 5 }),
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

/** The design box the menu declares — the frame the driver hands it. */
const DESIGN = { w: 600, h: 338 };

/** One driver frame, mirroring `gui/root.ts`. */
function paint(screen: UiScreen, input = emptyUiInput()): { f: UiFrame; probe: Probe } {
  const probe = probeCtx();
  const f = beginUi(probe.ctx, DESIGN.w, DESIGN.h, input, screen.focus ?? 0, true);
  screen.paint(f, screen);
  screen.focus = clampFocus(f.focus, f.count);
  return { f, probe };
}

/** Wheel input, with the pointer parked inside the region. */
function wheelDown(): ReturnType<typeof emptyUiInput> {
  const input = emptyUiInput();
  input.pointer = { x: 300, y: 200, inside: true, down: false, pressed: false, released: false };
  input.scroll = 400;
  return input;
}

const TABS = [
  { digit: 1, name: "gear" },
  { digit: 2, name: "cards" },
  { digit: 3, name: "skills" },
  { digit: 4, name: "bestiary" },
  { digit: 5, name: "stats" },
  { digit: 6, name: "options" },
] as const;

/**
 * Open the menu on a tab, the way a player does: press the digit, then let the
 * next frame paint the tab it switched to.
 */
async function openTab(digit: number): Promise<UiScreen> {
  // Imported in the test body, not at the top: the module graph pulls in the
  // item and card art, and `document` is only shimmed once `beforeAll` has run.
  const { menuScreen } = await import("./menu");
  const screen = menuScreen(() => {});
  const jump = emptyUiInput();
  jump.digit = digit;
  paint(screen, jump);
  return screen;
}

/** Saturate the wheel, then read what the region actually did. */
function saturate(screen: UiScreen): { view: Probe["clips"][number]; shift: number; painted: number } {
  // The content height is measured from the PREVIOUS frame's paint, so the first
  // frame declares 0. Twelve frames is well past both that and the clamp.
  for (let i = 0; i < 12; i++) paint(screen, wheelDown());
  const { probe } = paint(screen, wheelDown());
  const view = probe.clips[0];
  expect(view).toBeDefined();
  return { view, shift: probe.shifts[0] ?? 0, painted: probe.regionBottom - view.y };
}

/**
 * A run with things in it.
 *
 * `cards` and `bestiary` size themselves from `state`, so a fresh run only ever
 * tested their SHORTEST form — the handoff that raised this bug flagged the rich
 * case as unverified for exactly that reason. Every kind killed also flips every
 * bestiary row from the one-line "???" form to the tall form with drops and
 * mechanics, which is where the old formula's flat `52` per row came from.
 */
function seedRichRun(): () => void {
  const saved = {
    stash: state.cardStash,
    kills: state.killsByKind,
    reagents: state.reagents,
    flasks: state.flasks,
  };
  state.cardStash = Array.from({ length: 14 }, () => cardKey(cardsOfRarity("common")[0], 1, false));
  state.killsByKind = Object.fromEntries(KIND_IDS.map((k) => [k, 5]));
  state.reagents = Object.fromEntries(REAGENT_IDS.map((r) => [r, 3])) as typeof state.reagents;
  state.flasks = 4;
  return () => {
    state.cardStash = saved.stash;
    state.killsByKind = saved.kills;
    state.reagents = saved.reagents;
    state.flasks = saved.flasks;
  };
}

describe("the knight menu's scroll extent", () => {
  it.each(TABS)("paints something inside the region — $name", async ({ digit }) => {
    // Anti-vacuity for everything below: a tab that painted nothing would also
    // "never scroll into void".
    const screen = await openTab(digit);
    const { painted } = saturate(screen);
    expect(painted).toBeGreaterThan(ROW_H);
  });

  it.each(TABS)("can scroll to the lowest thing it paints — $name", async ({ digit }) => {
    const screen = await openTab(digit);
    const { view, shift, painted } = saturate(screen);
    // The band of content the view is showing, at full scroll.
    expect(shift + view.h).toBeGreaterThanOrEqual(painted);
  });

  it.each(TABS)("cannot scroll past it into void — $name", async ({ digit }) => {
    const screen = await openTab(digit);
    const { view, shift, painted } = saturate(screen);
    // One row of slack for the tail padding. The old formula missed by 664.
    expect(shift).toBeLessThanOrEqual(Math.max(0, painted - view.h) + ROW_H * 2);
  });

  it("has at least one tab that genuinely scrolls", async () => {
    // THE ANTI-VACUITY CHECK FOR THE PAIR ABOVE. If nothing were ever taller
    // than the view, `shift` would be 0 everywhere and both assertions would
    // hold for free — including after the fix was reverted.
    const restore = seedRichRun();
    try {
      const shifts: number[] = [];
      for (const t of TABS) shifts.push(saturate(await openTab(t.digit)).shift);
      expect(shifts.filter((s) => s > 0).length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });
});

describe("the same tabs on a run with a stash and a full bestiary", () => {
  it.each(TABS)("still matches what it paints — $name", async ({ digit }) => {
    const restore = seedRichRun();
    try {
      const screen = await openTab(digit);
      const { view, shift, painted } = saturate(screen);
      expect(painted).toBeGreaterThan(ROW_H);
      expect(shift + view.h).toBeGreaterThanOrEqual(painted);
      expect(shift).toBeLessThanOrEqual(Math.max(0, painted - view.h) + ROW_H * 2);
    } finally {
      restore();
    }
  });

  it("reaches the last card in a 14-card stash", async () => {
    // The stash is an ABSOLUTE grid — it indexes off `body.y` rather than cutting
    // — so measuring the flow cursor would stop at the STASH heading and strand
    // every row of it. This is the assertion that fails if `cardsTab` stops
    // cutting past its own grid.
    const restore = seedRichRun();
    try {
      const screen = await openTab(2);
      const { view, shift, painted } = saturate(screen);
      // A 14-card stash is taller than the view, so reaching its last row
      // REQUIRES the region to have scrolled.
      expect(painted).toBeGreaterThan(view.h);
      expect(shift).toBeGreaterThan(0);
      expect(shift + view.h).toBeGreaterThanOrEqual(painted);
    } finally {
      restore();
    }
  });
});
