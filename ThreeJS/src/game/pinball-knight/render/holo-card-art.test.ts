import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CARD_IDS, cardBase, CARDS } from "../cards";
import { IMPORTED_FACINGS, hasAuthoredFacing } from "../boot/manifest-inventory";

describe("Card Art & Pokémon Holographic Pipeline", () => {
  const artDir = join(__dirname, "..", "..", "..", "..", "public", "cards", "art");

  it("ensures all 25 monster and mythic cards have custom art assets in public/cards/art/", () => {
    expect(CARD_IDS.length).toBe(25);
    const missing: string[] = [];

    for (const id of CARD_IDS) {
      const base = cardBase(id);
      const filePath = join(artDir, `${base}.png`);
      if (!existsSync(filePath)) {
        missing.push(`${base}.png`);
      }
    }

    expect(missing, `Missing card art files: ${missing.join(", ")}`).toEqual([]);
  });

  it("verifies merchant facing S is registered and published in public/sprites/", () => {
    expect(hasAuthoredFacing("merchant", "S")).toBe(true);
    expect(IMPORTED_FACINGS.merchant).toContain("S");

    const spritesDir = join(__dirname, "..", "..", "..", "..", "public", "sprites");
    const jsonPath = join(spritesDir, "merchant-S.json");
    const pngPath = join(spritesDir, "merchant-S.png");

    expect(existsSync(jsonPath), "merchant-S.json exists").toBe(true);
    expect(existsSync(pngPath), "merchant-S.png exists").toBe(true);

    const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(manifest.name).toBe("merchant");
    expect(manifest.dir).toBe("S");
    expect(manifest.rows.length).toBeGreaterThanOrEqual(2);
  });
});
