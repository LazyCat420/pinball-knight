/**
 * A CHARACTER WHO WALKS AS HIMSELF MUST NOT SPRINT AS SOMEBODY ELSE.
 *
 * `resolvePaints` merges imported clips over the PAINTER's per clip, so any clip
 * an imported sheet does not author falls through to the knight. For most clips
 * that is the right degrade. For `run` it was the loudest bug on the character
 * select: Mario walked as Mario and sprinted as the knight, mid-step.
 *
 * Publishing `walk`'s frames a second time under `run` is what `mislabel.test.ts`
 * exists to reject — two clip rows of the same pixels mean one is mislabelled —
 * and it is not what the source says either: the Paper Mario sheet's caption is
 * literally "Walk / Run", one animation for both. So the reuse happens here, at
 * runtime, where the animator's own `run` frame rate makes it read as a faster
 * gait rather than as a copy.
 */
import { describe, it, expect } from "vitest";
import { importedPaints, type ImportedSheet } from "./imported-paints";
import type { SheetManifest } from "../tools/sprite-forge/manifest";

/** A sheet with the given clips. Nothing draws, so the image need not decode. */
function sheetWith(clips: string[], dir: "S" | "N" | "E" = "S"): ImportedSheet {
  const manifest: SheetManifest = {
    name: "test",
    dir,
    image: "/sprites/test.png",
    source: [64, 64],
    rows: clips.map((clip) => ({ clip, cells: [[0, 0, 15, 15]] as unknown as SheetManifest["rows"][0]["cells"] })),
  } as SheetManifest;
  return { manifest, image: { width: 64, height: 64 } as unknown as CanvasImageSource };
}

describe("run falls back to the sheet's own walk, not to the painter", () => {
  it("aliases run to walk when the sheet authors walk but no run", () => {
    const paints = importedPaints([sheetWith(["idle", "walk"])]);
    expect(paints).not.toBeNull();
    expect(paints?.S.run).toBeDefined();
    // BY REFERENCE, so startSpriteSheet's dedupe packs the frames once and the
    // atlas does not grow. A structural copy would pass this as `toEqual` and
    // silently double the width of every imported sheet.
    expect(paints?.S.run).toBe(paints?.S.walk);
  });

  it("applies to every facing, since every facing merged the same walk", () => {
    const paints = importedPaints([sheetWith(["idle", "walk"])]);
    expect(paints?.N.run).toBe(paints?.N.walk);
    expect(paints?.E.run).toBe(paints?.E.walk);
  });

  it("NEVER overrides a run the sheet actually authored", () => {
    // The negative control. Without it this would pass for an alias that
    // clobbered real art — the exact opposite of the intent.
    const paints = importedPaints([sheetWith(["idle", "walk", "run"])]);
    expect(paints?.S.run).not.toBe(paints?.S.walk);
    expect(paints?.S.run?.length).toBeGreaterThan(0);
  });

  it("leaves run ABSENT when the sheet has no walk either", () => {
    // Nothing to alias from, so the painter is still the honest answer — an
    // empty clip freezes the animator, which is worse than a knight frame.
    const paints = importedPaints([sheetWith(["idle", "attack"])]);
    expect(paints?.S.run).toBeUndefined();
  });
});
