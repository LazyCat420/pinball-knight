/**
 * DOES THE ART IN `public/sprites/` ACTUALLY REACH THE GAME?
 *
 * The forge's own report says a sheet sliced, censused and published cleanly.
 * It cannot say whether `applyImportedArt` will USE it — that call drops a
 * creature's whole sheet set, silently and by design, whenever `importedPaints`
 * returns null: no playable rows, or no `idle` on the facing the others fall
 * back to. The monster then draws with its painter and the only trace is a
 * boot log that never printed.
 *
 * The zombie shipped in exactly that state: six labelled rows, 24 frames, a
 * COMPETITIVE verdict, `public/sprites/zombie-E.{png,json}` on disk — and rows
 * named `walk/walk/attack/attack/death/death`, so no idle, so null, so the
 * painter. Nothing failed. This is the test that fails.
 *
 * It reads the sheet names out of `boot/sheets.ts` rather than restating them:
 * a mirror of that table would pass while the table it mirrors went stale,
 * which is the same shape of defect one level up.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadImage } from "canvas";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { installSpriteTestDom } from "../../testkit/atlas-census";
import { importedPaints, type ImportedSheet } from "../../render/imported-paints";
import type { SheetManifest } from "./manifest";
import type { Dir } from "../../engine/render/paint-types";

const PUBLIC = join(__dirname, "..", "..", "..", "..", "..", "public", "sprites");
const SHEETS_TS = join(__dirname, "..", "..", "boot", "sheets.ts");

/** The facings the loader asks for, in `boot/sheets.ts`'s order. */
const DIRS: Dir[] = ["S", "N", "E"];

/** `IMPORTED_ART` from the source of truth: SheetKey → sheet name. */
function importedArt(): [string, string][] {
  const src = readFileSync(SHEETS_TS, "utf8");
  const block = /const IMPORTED_ART[^=]*=\s*\{([^}]*)\}/.exec(src);
  if (!block) throw new Error("[forge] could not find IMPORTED_ART in boot/sheets.ts");
  return [...block[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
}

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

describe("published sheets", () => {
  it("every kind in IMPORTED_ART loads into playable paints", async () => {
    const art = importedArt();
    expect(art.length, "IMPORTED_ART parsed as empty — did the table's shape change?")
      .toBeGreaterThan(0);

    for (const [key, name] of art) {
      const sheets: ImportedSheet[] = [];
      for (const dir of DIRS) {
        const jsonPath = join(PUBLIC, `${name}-${dir}.json`);
        if (!existsSync(jsonPath)) continue;
        const manifest = JSON.parse(readFileSync(jsonPath, "utf8")) as SheetManifest;
        const image = await loadImage(join(PUBLIC, `${name}-${dir}.png`));
        // The same size check the loader runs — a re-export at another size
        // shifts every cell rect and falls back to the painter at runtime.
        const [w, h] = manifest.source;
        expect(Math.abs(image.width - w), `${name}-${dir}: sheet is ${image.width}x${image.height}, manifest says ${w}x${h} — re-run \`npm run sprites\``)
          .toBeLessThanOrEqual(2);
        expect(Math.abs(image.height - h)).toBeLessThanOrEqual(2);
        sheets.push({ manifest, image: image as unknown as CanvasImageSource });
      }
      expect(sheets.length, `${key}: IMPORTED_ART points at "${name}" but public/sprites has no such sheet`)
        .toBeGreaterThan(0);

      const paints = importedPaints(sheets);
      expect(
        paints,
        `${key}: "${name}" publishes ${sheets.length} sheet(s) that produce NO playable paints — ` +
          `the game will silently keep the painter. Every facing's rows: ` +
          sheets.map((s) => `${s.manifest.dir}=[${s.manifest.rows.map((r) => r.clip).join(",")}]`).join(" ") +
          `. The usual cause is no "idle" row.`,
      ).not.toBeNull();
      // idle is what the animator lands on for any clip an actor does not
      // author, so an empty one is a frozen monster rather than a missing clip.
      for (const dir of DIRS) {
        expect(paints?.[dir].idle?.length, `${key}: facing ${dir} has an empty idle`).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});
