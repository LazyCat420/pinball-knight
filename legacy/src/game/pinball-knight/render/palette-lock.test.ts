/**
 * The per-sprite palette lock, measured on a REAL built atlas.
 *
 * `render/monsters/noise.test.ts` crushes one frame at a time and so cannot see
 * this: the lock needs the whole sheet's histogram and runs once, when the atlas
 * is complete. This is the test that covers it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { buildSpriteSheet, lockEviction } from "../engine/render/sprite";
import { withRecoil, makeSpiderPaints } from "./cel-painter";
import { makeJesterPaints } from "./monsters/jester";
import { makeStiltneckPaints } from "./monsters/stiltneck";
import { makeRotortailPaints } from "./monsters/rotortail";
import { installPalette, PALETTE_HEX } from "./palette";
import type { ActorPaints } from "../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  installPalette();
});
afterAll(() => { (globalThis as { document?: unknown }).document = realDoc; });

const CAP = 20;

function atlasEntries(paints: ActorPaints, opts: { lockEntries?: number }): { entries: number; opaque: number } {
  const sheet = buildSpriteSheet(withRecoil(paints), opts);
  const canvas = sheet.texture.image as unknown as { width: number; height: number; getContext: (t: string) => CanvasRenderingContext2D };
  const ctx = canvas.getContext("2d");
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const seen = new Set<number>();
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] <= 127) continue;
    opaque++;
    seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  return { entries: seen.size, opaque };
}

const SUBJECTS: [string, () => ActorPaints][] = [
  ["jester", makeJesterPaints],
  ["stiltneck", makeStiltneckPaints],
  ["rotortail", makeRotortailPaints],
  ["spider", makeSpiderPaints],
];

describe("per-sprite palette lock", () => {
  it("caps every monster atlas at the budget, and the cap BITES", () => {
    const rows: string[] = [];
    let everBit = false;
    for (const [name, make] of SUBJECTS) {
      const before = atlasEntries(make(), {});
      const after = atlasEntries(make(), { lockEntries: CAP });
      // Anti-vacuity: an empty atlas has zero entries and passes any cap.
      expect(before.opaque, `${name}: built an EMPTY atlas`).toBeGreaterThan(2000);
      expect(after.opaque, `${name}: lock emptied the atlas`).toBe(before.opaque);
      expect(after.entries, `${name}: ${after.entries} entries against a ${CAP} cap`).toBeLessThanOrEqual(CAP);
      if (before.entries > CAP) everBit = true;
      rows.push(`${name.padEnd(10)} ${before.entries} → ${after.entries}`);
    }
    // If nothing was over budget the assertions above are all trivially true and
    // this test would keep passing after the lock was deleted.
    expect(everBit, `no subject exceeded the cap, so the lock is untested:\n${rows.join("\n")}`).toBe(true);
    console.log(`\npalette lock (cap ${CAP})\n${rows.join("\n")}`);
  }, 120_000);

  it("keeps ink and the brightest entry, whatever their pixel counts", () => {
    atlasEntries(makeJesterPaints(), { lockEntries: CAP });
    const report = lockEviction();
    expect(report, "no lock report — the lock did not run").not.toBeNull();
    // Ink is a quarter of every actor's pixels; losing it dissolves the outline.
    expect(report!.kept, "ink was evicted").toContain(1);
    // Glow cores are a handful of texels — an eye, a spark — and lose every
    // popularity contest while carrying the creature's focal point. The lock
    // force-keeps the brightest present entry for exactly that reason.
    const luma = (i: number): number =>
      0.3 * ((PALETTE_HEX[i] >> 16) & 255) + 0.59 * ((PALETTE_HEX[i] >> 8) & 255) + 0.11 * (PALETTE_HEX[i] & 255);
    const brightestKept = report!.kept.reduce((a, b) => (luma(b) > luma(a) ? b : a));
    for (const e of report!.evicted) {
      expect(luma(e), `evicted ${e}, brighter than every keeper`).toBeLessThanOrEqual(luma(brightestKept));
    }
  }, 120_000);

  it("only ever merges — a locked atlas uses a SUBSET of the unlocked one", () => {
    // A row map cannot invent a colour, so this is structural. Asserting it
    // catches a remap that reached outside the palette or off the keep set.
    const sheetOf = (opts: { lockEntries?: number }): Set<number> => {
      const sheet = buildSpriteSheet(withRecoil(makeRotortailPaints()), opts);
      const canvas = sheet.texture.image as unknown as { width: number; height: number; getContext: (t: string) => CanvasRenderingContext2D };
      const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 127) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen;
    };
    const open = sheetOf({});
    const locked = sheetOf({ lockEntries: CAP });
    for (const c of locked) expect(open.has(c), `locked atlas introduced 0x${c.toString(16)}`).toBe(true);
  }, 120_000);
});
