import { describe, it, expect } from "vitest";
import { SHALLOW, DEEP, SWEEP_LEVELS, SATURATION_LEVEL } from "./sweep-axis";
import { ARCHETYPES, archetypeFor } from "./archetypes";
import { levelConfig } from "../constants";

/**
 * THE AXIS ITSELF IS GATED.
 *
 * A trimmed sweep is only safe while its premise holds — that depth stops
 * varying past `SATURATION_LEVEL`, and that five consecutive levels walk every
 * archetype. Both are re-derived here from `levelConfig` and `archetypeFor`
 * rather than restated, so a tuning change that pushes a budget cap deeper
 * fails HERE, loudly, instead of silently turning every other sweep into a
 * mid-range sample that no longer tests the saturated case.
 *
 * This is the test that makes cutting the other sweeps defensible.
 */
const fields = (l: number) => {
  const c = levelConfig(l);
  return {
    cellsW: c.cellsW,
    cellsH: c.cellsH,
    zombies: c.zombies,
    zombieSpeed: c.zombieSpeed,
    torches: c.torches,
    braid: c.braid,
    rooms: c.rooms,
    secrets: c.secrets,
    launchBreaks: c.launchBreaks,
  };
};

describe("sweep axis", () => {
  it("levelConfig is CONSTANT from SATURATION_LEVEL onward", () => {
    // The premise. If this fails, every trimmed sweep in maze/ is now blind to
    // whatever started moving again — do not relax it, raise SATURATION_LEVEL.
    const at = JSON.stringify(fields(SATURATION_LEVEL));
    const moved: string[] = [];
    for (let l = SATURATION_LEVEL; l <= 60; l++) {
      const here = JSON.stringify(fields(l));
      if (here !== at) moved.push(`L${l}: ${here}`);
    }
    expect(moved.join("\n")).toBe("");
  });

  it("SATURATION_LEVEL is TIGHT — something still moves just before it", () => {
    // Guards the other direction. A saturation level set far too deep would
    // make the claim trivially true and the DEEP sweep needlessly expensive,
    // and nothing else would notice.
    expect(JSON.stringify(fields(SATURATION_LEVEL - 1))).not.toBe(JSON.stringify(fields(SATURATION_LEVEL)));
  });

  it("SHALLOW and DEEP each walk every archetype exactly once", () => {
    // The other axis. Five consecutive levels cover the modulo-5 cycle; if
    // ARCHETYPES ever grows, these lists grow with it because they are derived
    // from it — but the cover is asserted, not assumed.
    for (const [name, levels] of [
      ["SHALLOW", SHALLOW],
      ["DEEP", DEEP],
    ] as const) {
      const ids = levels.map((l) => archetypeFor(l).id);
      expect(`${name}: ${[...new Set(ids)].length}`).toBe(`${name}: ${ARCHETYPES.length}`);
    }
  });

  it("the two ends are genuinely different floor sizes", () => {
    // If they were not, the sweep would be paying twice for one regime.
    const small = levelConfig(SHALLOW[0]);
    const big = levelConfig(DEEP[0]);
    expect(big.cellsW * big.cellsH).toBeGreaterThan(small.cellsW * small.cellsH * 3);
  });

  it("covers both regimes in ten levels", () => {
    expect(SWEEP_LEVELS.length).toBe(2 * ARCHETYPES.length);
  });
});
