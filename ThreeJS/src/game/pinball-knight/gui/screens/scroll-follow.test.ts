/**
 * NO SCROLLING SCREEN LEAVES ITS FOCUS CURSOR OFF-SCREEN.
 *
 * `beginScroll` advances only from the mouse WHEEL, and only while the pointer is
 * inside the region. So a screen taller than its view is mouse-only unless it
 * scrolls to follow the focus cursor: the D-pad walks the ring off the bottom, the
 * highlight vanishes, and Enter fires a button nobody can see. That reads as the
 * UI having frozen, which is why `scrollToShow` was written — in the P0 UI commit,
 * after which NOTHING CALLED IT FOR FIVE MONTHS.
 *
 * `settings.ts` shows what living with it looks like: the note over
 * `settingsBody` explains that CAMERA was moved to the top of the sheet because it
 * was "the one control the player was hunting for" and it sat below the fold.
 * Reordering rows to dodge a broken scroll region works until the next row lands.
 *
 * ── TWO TESTS, BECAUSE THE BUG HAD TWO HALVES ──
 * The behavioural half walks the cursor over every widget of every scrolling
 * screen and asserts the focused row is inside the visible band. The STRUCTURAL
 * half asserts that every file calling `beginScroll` also calls `followFocus` —
 * because the original failure was not a wrong calculation, it was five screens
 * that never made the call, and a behavioural test only covers the screens someone
 * remembered to add here. A sixth scrolling screen fails the structural test on
 * the day it is written.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "canvas";
import { emptyUiInput } from "../im";
import type { UiScreen } from "../stack";
import { paintFrame, frameFor } from "./scroll-probe";

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
 * A PURSE. Price buttons grey out below their cost and a disabled row registers no
 * rect, so at the wallet's default the shop-like screens have few focusable rows
 * and they all sit above the fold — the assertions would pass vacuously. Mocked
 * rather than granted because the wallet persists via `localStorage`, which this
 * environment does not have.
 */
vi.mock("../../../../utils/gold-wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../utils/gold-wallet")>()),
  getBalance: () => 9000,
}));

/** Every debug action is a no-op; the screen only needs them to be callable. */
function stubActions(): never {
  return new Proxy({}, { get: () => () => {} }) as never;
}

interface Case {
  name: string;
  make: () => Promise<UiScreen>;
  /** Presses of `nextTab` before walking, for the screens that have tabs. */
  tabs?: number;
}

const CASES: Case[] = [
  {
    name: "menu",
    make: async () => (await import("./menu")).menuScreen(() => {}),
    // Every tab: each keeps its own offset, and they differ wildly in height —
    // the bestiary is a long grid, the equipment paperdoll is not.
    tabs: 6,
  },
  { name: "settings", make: async () => (await import("./settings")).settingsScreen() },
  { name: "debug", make: async () => (await import("./debug")).debugScreen(stubActions()) },
  {
    name: "haul",
    make: async () => {
      const { haulScreen } = await import("./haul");
      const { cardKey, cardsOfRarity } = await import("../../cards");
      // A REAL base, taken from the roster rather than written down: `stackHaul`
      // drops anything `cardDef` does not know, so an invented id yields an empty
      // haul that scrolls nowhere and the test passes having rendered nothing.
      // DISTINCT ids. `stackHaul` groups by id, so 24 copies of one card collapse
      // into a SINGLE cell — the screen then has one focusable and scrolls nowhere,
      // and every assertion below passes having rendered almost nothing.
      const bases = [...cardsOfRarity("common"), ...cardsOfRarity("rare"), ...cardsOfRarity("epic")];
      const entries = bases.flatMap((base, i) =>
        [1, 4].map((level) => ({
          id: cardKey(base, level, false),
          note: i % 2 ? "STASHED" : "SOCKETED INTO SWORD",
          fresh: i === 0,
        })),
      );
      expect(entries.length).toBeGreaterThan(12); // several screenfuls, not a row
      return haulScreen(entries, 7, () => {});
    },
  },
  {
    name: "tavern",
    make: async () =>
      (await import("./tavern")).tavernScreen({
        onDescend: () => {},
        stats: { grade: "B", floor: 7, kills: 42, bestCombo: 6 },
        vendor: "potions",
        onClose: () => {},
      }),
  },
];

/**
 * Walk the cursor over every widget and check the focused row is visible.
 *
 * Returns how many positions were inside a scroll region and how many of those
 * needed the region to have scrolled — the caller asserts on both, because a
 * screen that never scrolls satisfies "the cursor is visible" for free.
 */
function walk(screen: UiScreen, tabPresses = 0): { checked: number; scrolled: number } {
  const size = frameFor(screen);
  let checked = 0;
  let scrolled = 0;

  for (let tab = 0; tab <= tabPresses; tab++) {
    if (tab > 0) {
      const next = emptyUiInput();
      next.nextTab = 1;
      paintFrame(screen, size, next);
      paintFrame(screen, size);
    }
    const total = paintFrame(screen, size).f.count;

    // ── PRESS DOWN. Do not assign `screen.focus`. ──
    // Assigning it teleports the cursor to an index no player could reach in one
    // step, and `moveFocus` then walks it further to escape any disabled run —
    // measured on the SKILLS tab, an assignment of 24 landed on 30. The scroll for
    // where it landed is computed in that same paint and applied by the next, so
    // a teleport is permanently one jump behind and the test reports a failure the
    // game does not have. A press moves the cursor by ONE focusable, which is the
    // only motion the region has to keep up with.
    for (let step = 0; step < total + 1; step++) {
      // THREE PAINTS, and each one is load-bearing. Immediate mode costs a frame
      // at every hand-off, so the region is always one behind the cursor — which
      // is invisible at 60Hz and fatal to a test that asserts too early:
      //   1. paints with the OLD cursor; the driver then advances it.
      //   2. paints with the NEW cursor; `followFocus` computes its scroll.
      //   3. paints with that scroll applied — the first frame a player could
      //      actually see the row, and the only one worth asserting on.
      const down = emptyUiInput();
      down.down = 1;
      paintFrame(screen, size, down);
      paintFrame(screen, size);
      const { f, probe } = paintFrame(screen, size);

      // No rect = the cursor is on a disabled row, which `moveFocus` no longer
      // stops on. Not clipped = chrome outside the region, always visible anyway.
      if (!f.focusRect || !f.focusClipped) continue;
      const view = probe.clips[0];
      if (!view) continue;
      const shift = probe.shifts[0] ?? 0;
      const bandTop = view.y + shift;
      expect(f.focusRect.y).toBeGreaterThanOrEqual(bandTop);
      expect(f.focusRect.y + f.focusRect.h).toBeLessThanOrEqual(bandTop + view.h);
      checked++;
      if (shift > 0) scrolled++;
    }
  }
  return { checked, scrolled };
}

describe("every scrolling screen follows its focus cursor", () => {
  it.each(CASES)("$name", async ({ make, tabs }) => {
    const screen = await make();
    const { checked, scrolled } = walk(screen, tabs ?? 0);
    expect(checked).toBeGreaterThan(1);
    // ANTI-VACUITY. If no position ever needed the region to move, the
    // assertions above held for free and this would keep passing after a revert.
    expect(scrolled).toBeGreaterThan(0);
  });
});

describe("the structural guard", () => {
  const DIR = join(__dirname);

  it("every screen that scrolls also follows the cursor", () => {
    // The original bug was not arithmetic — it was five screens that never made
    // the call. This is the assertion a SIXTH one fails on the day it is written.
    const offenders: string[] = [];
    for (const file of readdirSync(DIR)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const src = readFileSync(join(DIR, file), "utf8");
      if (!src.includes("beginScroll(")) continue;
      if (!src.includes("followFocus(")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("finds the screens it claims to be checking", () => {
    // Guards the guard: a glob that matches nothing passes the test above.
    const scrollers = readdirSync(DIR).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && readFileSync(join(DIR, f), "utf8").includes("beginScroll("),
    );
    expect(scrollers.length).toBeGreaterThanOrEqual(5);
  });
});
