import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KEEPERS } from "./npcs";

describe("Tavern Animated Keepers Sprite Sheets", () => {
  const spritesDir = join(__dirname, "..", "..", "..", "public", "sprites");

  it("every keeper has a distinct sheetKey defined", () => {
    const sheetKeys = KEEPERS.map((k) => k.sheetKey);
    expect(sheetKeys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    expect(new Set(sheetKeys).size).toBe(KEEPERS.length);
  });

  it("published sprite files (JSON manifest and PNG texture) exist for every keeper", () => {
    for (const k of KEEPERS) {
      const jsonPath = join(spritesDir, `${k.sheetKey}-S.json`);
      const pngPath = join(spritesDir, `${k.sheetKey}-S.png`);
      expect(existsSync(jsonPath), `manifest exists for ${k.sheetKey}`).toBe(true);
      expect(existsSync(pngPath), `texture exists for ${k.sheetKey}`).toBe(true);

      const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));
      expect(manifest.name).toBe(k.sheetKey);
      expect(manifest.dir).toBe("S");
      expect(manifest.rows.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("published sprite files exist for roaming maze merchant", () => {
    const jsonPath = join(spritesDir, "maze_merchant-S.json");
    const pngPath = join(spritesDir, "maze_merchant-S.png");
    expect(existsSync(jsonPath), "manifest exists for maze_merchant").toBe(true);
    expect(existsSync(pngPath), "texture exists for maze_merchant").toBe(true);

    const manifest = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(manifest.name).toBe("maze_merchant");
    expect(manifest.dir).toBe("S");
    expect(manifest.rows.length).toBeGreaterThanOrEqual(4);
  });
});
