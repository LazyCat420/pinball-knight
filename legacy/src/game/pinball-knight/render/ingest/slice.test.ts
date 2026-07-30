/**
 * WHAT THE ALPHA SLICER ACTUALLY DOES.
 *
 * A characterisation suite, not an aspirational one. `sliceSheet` shipped
 * untested: its only caller was the inbox loop, and the inbox is empty, so
 * `npm run sprites` was GREEN while executing none of it — and every measured
 * claim in its comments came from a fixture that was never committed.
 *
 * These tests pin the behaviour as it is, INCLUDING WHERE IT IS WRONG, so that
 * `grid.ts` replacing it is a visible diff rather than a claim. Two of them
 * assert a defect. They are marked, and they are the reason the next stage
 * exists.
 */
import { describe, it, expect } from "vitest";
import { sliceSheet } from "./slice";
import { buildSheet, shapeOf } from "./fixtures";

const RAGGED = [4, 6, 4, 2, 3];
const TRUTH = RAGGED.join("/");

describe("sliceSheet — rows", () => {
  it("finds one band per row, and captions are not rows", () => {
    const { data, w, h } = buildSheet({ rows: RAGGED, captions: true });
    // Five clips in, five bands out. With captions counted this would be ten —
    // the caption test is the only thing between a label bar and a "pose".
    expect(sliceSheet(data, w, h).length).toBe(RAGGED.length);
  });

  it("keeps the row count when a row is indented", () => {
    const { data, w, h } = buildSheet({ rows: RAGGED, indentRow: 3 });
    expect(sliceSheet(data, w, h).length).toBe(RAGGED.length);
  });
});

describe("sliceSheet — cells", () => {
  it("DEFECT: a ruled sheet does not recover its cell counts", () => {
    const { data, w, h } = buildSheet({ rows: RAGGED, ruled: true });
    const shape = shapeOf(sliceSheet(data, w, h));
    // Measured: 9/7/9/5/7 against a truth of 4/6/4/2/3. Two causes, both fixed
    // in grid.ts and both reproduced by this fixture:
    //
    //  1. A "vertical rule" is tested by HEIGHT alone, so a figure's own solid
    //     core — 44 px of body spanning the whole band — is erased as though it
    //     were a border, and the figure splits around the hole it just made.
    //  2. RULE_FILL is measured against the SHEET width. A ragged sheet's short
    //     rows never reach 70% of it, so their ruled borders survive and weld
    //     the whole row together. (This is the documented "1/6/1/1/1".)
    expect(shape).not.toBe(TRUTH);
  });

  it("DEFECT: an unruled sheet — the format we ask generators for — slices to nothing", () => {
    const { data, w, h } = buildSheet({ rows: RAGGED, ruled: false, gutter: 12 });
    // The canonical target format: transparent background, no grid lines, no
    // captions in gutters, clear space between cells. Today it returns ZERO
    // cells, because cause (1) above erases every opaque column in the band:
    // measured 176 of 176 columns stripped as "vertical rules".
    //
    // Constraining a rule to be tall AND NARROW (<= 3 px) makes this fixture
    // slice to exactly 4/6/4/2/3 — measured. That is grid.ts's first job.
    expect(shapeOf(sliceSheet(data, w, h))).toBe("");
  });

  it("a transparent column inside a pose is not what splits it", () => {
    // One cell, legs apart. The leg gap is blamed in the shipped comments for
    // splitting figures; it is not the cause. The figure vanishes entirely,
    // gap or no gap — the erasure above happens first.
    const withGap = buildSheet({ rows: [1], ruled: false, captions: false });
    expect(sliceSheet(withGap.data, withGap.w, withGap.h).length).toBe(0);
  });
});

describe("sliceSheet — the inputs it cannot take", () => {
  it("an opaque background collapses the whole sheet to one cell", () => {
    const { data, w, h } = buildSheet({ rows: RAGGED, opaqueBg: [240, 237, 230] });
    const cells = sliceSheet(data, w, h).flatMap((r) => r.cells);
    // THE ONLY INPUT AN AI GENERATOR PRODUCES. Diffusion models have no alpha
    // channel, so every generated sheet arrives like this. One cell is the
    // caller's cue to fail loudly — and the reason matte.ts has to run first.
    expect(cells.length).toBeLessThanOrEqual(1);
  });

  it("a row label in the LEFT GUTTER imports as a frame", () => {
    const plain = buildSheet({ rows: [4], captions: false, gutterLabels: false });
    const labelled = buildSheet({ rows: [4], captions: false, gutterLabels: true });
    const before = shapeOf(sliceSheet(plain.data, plain.w, plain.h));
    const after = shapeOf(sliceSheet(labelled.data, labelled.w, labelled.h));
    // Moving a caption from UNDER a row into its LEFT GUTTER defeats the caption
    // test entirely: the label shares the row's band, so its height IS the row's
    // height and CAPTION_RATIO never sees it. It then clears the 25% width
    // filter and becomes a pose. Sheets must not label their gutters.
    expect(after).not.toBe(before);
  });
});
