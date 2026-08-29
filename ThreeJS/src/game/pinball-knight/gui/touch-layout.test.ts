/**
 * THE ON-SCREEN PAD'S GEOMETRY.
 *
 * Every failure this guards is invisible in code review and obvious to a
 * player: a button half off the screen, two buttons that overlap so the wrong
 * one wins, a cluster that eats the movement stick, or a mapping that has
 * drifted from the physical controller's.
 *
 * The grids are REAL — they are what `computeRenderSizing` hands the UI on the
 * devices this has to work on, not round numbers.
 */
import { describe, it, expect } from "vitest";
import { padHit, padLayout, padUnit, stickHome, type TouchButton } from "./touch-layout";

/** [label, grid w, grid h] — the grid, not the window. */
const GRIDS: ReadonlyArray<readonly [string, number, number]> = [
  ["phone portrait", 430, 932],
  ["phone landscape", 932, 430],
  ["small phone landscape", 667, 375],
  ["tablet landscape", 1180, 820],
  ["tablet portrait", 820, 1180],
  ["desktop ?touch=1 1080p", 1920, 1080],
  ["desktop ?touch=1 1440p", 2560, 1298],
  ["foldable square-ish", 900, 880],
];

/**
 * Do two buttons overlap, in the shapes `padHit` actually tests?
 *
 * Discs must be compared as CIRCLES. Treating them as bounding squares says the
 * face diamond overlaps itself — the diagonal neighbours are `spread` apart on
 * each axis, which is less than the sum of two radii, while the real centre
 * distance is `spread * sqrt(2)`, comfortably clear. A box test there fails a
 * layout that is correct, which is worse than not testing it.
 */
function overlaps(a: TouchButton, b: TouchButton): boolean {
  if (a.shape === "disc" && b.shape === "disc") return Math.hypot(a.x - b.x, a.y - b.y) < a.rx + b.rx;
  // Disc-vs-pill uses the box, which is CONSERVATIVE (a disc's box is bigger
  // than the disc), so a pass here is a pass for the real shapes too.
  return Math.abs(a.x - b.x) < a.rx + b.rx && Math.abs(a.y - b.y) < a.ry + b.ry;
}

describe("the on-screen pad's layout", () => {
  it.each(GRIDS)("keeps every button fully on screen — %s", (_label, w, h) => {
    for (const b of padLayout(w, h)) {
      expect(b.x - b.rx, `${b.id} off the left`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.rx, `${b.id} off the right`).toBeLessThanOrEqual(w);
      expect(b.y - b.ry, `${b.id} off the top`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.ry, `${b.id} off the bottom`).toBeLessThanOrEqual(h);
    }
  });

  it.each(GRIDS)("never overlaps two buttons — %s", (_label, w, h) => {
    const bs = padLayout(w, h);
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        expect(overlaps(bs[i], bs[j]), `${bs[i].id} overlaps ${bs[j].id}`).toBe(false);
      }
    }
  });

  it.each(GRIDS)("keeps the buttons clear of the movement stick — %s", (_label, w, h) => {
    // The stick is not just its resting disc: the thumb throws it, and the
    // whole left half raises it. A button the left thumb can sit on is a button
    // that steals a step.
    const home = stickHome(w, h);
    for (const b of padLayout(w, h)) {
      const dx = Math.max(0, Math.abs(b.x - home.x) - b.rx);
      const dy = Math.max(0, Math.abs(b.y - home.y) - b.ry);
      expect(Math.hypot(dx, dy), `${b.id} sits on the stick`).toBeGreaterThan(home.r * 1.15);
    }
  });

  it.each(GRIDS)("gives every button a thumb-sized target — %s", (_label, w, h) => {
    // ~7mm is the usual floor for a touch target. These are UI pixels, which
    // are upscaled by `scale` on the way to the screen, so the bar here is the
    // SMALLEST case: at scale 1 on a phone one UI pixel is one CSS pixel, and
    // 18 CSS px across is about as small as a reachable button gets.
    for (const b of padLayout(w, h)) {
      expect(Math.min(b.rx, b.ry) * 2, `${b.id} too small`).toBeGreaterThanOrEqual(16);
    }
  });

  it("mirrors the PlayStation face order — triangle up, circle right, cross down, square left", () => {
    const bs = padLayout(1920, 1080);
    const by = (id: string) => bs.find((b) => b.id === id)!;
    const tri = by("face-triangle");
    const cir = by("face-circle");
    const cro = by("face-cross");
    const sqr = by("face-square");
    expect(tri.y).toBeLessThan(cro.y);
    expect(sqr.x).toBeLessThan(cir.x);
    // The diamond is centred: the vertical pair share an x, the horizontal a y.
    expect(tri.x).toBe(cro.x);
    expect(sqr.y).toBe(cir.y);
  });

  it("binds the face cluster to the same actions as a physical pad", () => {
    // gamepad.ts: X/square attack, A/cross dodge, B/circle flip, Y/triangle
    // rampage, LB/RB the two skills, LT sprint, START menu, BACK map. If that
    // table moves, this is the test that says the thumb pad did not move with it.
    const bs = padLayout(1920, 1080);
    const action = (id: string) => bs.find((b) => b.id === id)!.action;
    expect(action("face-square")).toBe("attack");
    expect(action("face-cross")).toBe("dodge");
    expect(action("face-circle")).toBe("flip");
    expect(action("face-triangle")).toBe("rampage");
    expect(action("sh-l1")).toBe("skillQ");
    expect(action("sh-r1")).toBe("skillE");
    expect(action("sh-l2")).toBe("sprint");
    expect(action("sh-r2")).toBe("attack");
    expect(action("start")).toBe("menu");
    expect(action("select")).toBe("map");
  });

  it("can actually do everything the old pad could, plus the two it could not", () => {
    // The pad this replaced had no flipper and no rampage — `pad.flip` was in
    // the VirtualPad struct and nothing on the touch path ever set it.
    const actions = new Set(padLayout(1920, 1080).map((b) => b.action));
    for (const a of ["attack", "dodge", "sprint", "skillQ", "skillE", "map", "menu", "flip", "rampage"]) {
      expect(actions.has(a as never), `no way to ${a} by thumb`).toBe(true);
    }
  });

  it("gives every button a UNIQUE id, because presses are keyed by it", () => {
    // Square and R2 share an ACTION. If they shared an id, lifting one finger
    // would clear the other's press and leave the knight swinging.
    const bs = padLayout(1920, 1080);
    expect(new Set(bs.map((b) => b.id)).size).toBe(bs.length);
  });

  it("hit-tests where it paints", () => {
    for (const [, w, h] of GRIDS) {
      for (const b of padLayout(w, h)) {
        expect(padHit(b, b.x, b.y), `${b.id} centre misses`).toBe(true);
        // Just outside the box on each axis must miss, or two neighbours can
        // both claim the same pixel.
        expect(padHit(b, b.x + b.rx + 2, b.y)).toBe(false);
        expect(padHit(b, b.x, b.y + b.ry + 2)).toBe(false);
      }
    }
  });

  it("scales the pad with the grid instead of pinning it in pixels", () => {
    // The old layout was absolute (`r: 44`, `x: w - 78`): a third of a phone
    // screen, a thumbnail on a desktop one.
    const small = padUnit(667, 375);
    const large = padUnit(2560, 1298);
    expect(large).toBeGreaterThan(small);
    // ...but bounded at both ends, or the glyphs stop being legible / the
    // cluster starts eating the window.
    expect(padUnit(320, 200)).toBeGreaterThanOrEqual(9);
    expect(padUnit(7680, 2160)).toBeLessThanOrEqual(30);
  });

  it("is stable — the same grid lays out identically twice", () => {
    expect(padLayout(932, 430)).toEqual(padLayout(932, 430));
  });
});
