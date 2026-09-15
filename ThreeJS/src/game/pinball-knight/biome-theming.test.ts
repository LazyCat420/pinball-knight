import { describe, it, expect } from "vitest";
import { THEMES, themeFor } from "./maze/prefabs";
import { previewHordeKind } from "./spawn/factory";

describe("Biome-correlated monster horde generation", () => {
  it("keeps previewHordeKind strictly inside the biome's enemy roster", () => {
    // Sample floors across all 5 biomes
    const testFloors = [
      { floor: 1, theme: "crypt" },
      { floor: 3, theme: "crypt" },
      { floor: 5, theme: "crypt" },
      { floor: 6, theme: "warren" },
      { floor: 8, theme: "warren" },
      { floor: 10, theme: "warren" },
      { floor: 11, theme: "bloodworks" },
      { floor: 13, theme: "bloodworks" },
      { floor: 15, theme: "bloodworks" },
      { floor: 16, theme: "arcane" },
      { floor: 18, theme: "arcane" },
      { floor: 20, theme: "arcane" },
      { floor: 21, theme: "magma" },
      { floor: 23, theme: "magma" },
      { floor: 25, theme: "magma" },
    ];

    for (const { floor, theme } of testFloors) {
      const activeTheme = themeFor(floor);
      expect(activeTheme.name).toBe(theme);
      const allowedKinds = new Set(Object.keys(activeTheme.enemies ?? {}));

      // Roll 200 distinct spawn hashes for this floor
      for (let h = 0; h < 200; h++) {
        const hash = ((h * 1664525 + 1013904223) >>> 0);
        const kind = previewHordeKind(hash, floor);

        expect(
          allowedKinds.has(kind),
          `Floor ${floor} (${theme}) spawned unauthorized enemy "${kind}". Allowed: ${[...allowedKinds].join(", ")}`
        ).toBe(true);
      }
    }
  });

  it("never spawns modern joke or incongruous ocean enemies in standard dungeon biomes", () => {
    const prohibitedInCrypt = ["burger", "fries", "milkshake", "hotdog", "highway_patrol", "riot_cop", "clam", "octopus_gunner"];
    for (let floor = 1; floor <= 5; floor++) {
      for (let h = 0; h < 300; h++) {
        const hash = ((h * 22695477 + 1) >>> 0);
        const kind = previewHordeKind(hash, floor);
        expect(prohibitedInCrypt).not.toContain(kind);
      }
    }
  });
});
