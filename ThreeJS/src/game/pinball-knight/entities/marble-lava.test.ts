import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { materialBumperMult, lavaVaporizesOil, emitMaterialOnBounce } from "./marble";
import { state, type MarbleMaterial } from "../state";
import { LAVA_BUMPER_MULT, STONE_BUMPER_KICK_MULT } from "../constants";
import { MARBLE_SKINS } from "../render/cel-painter";
import { PALETTE_HEX } from "../render/palette";

function setPlayer(material: MarbleMaterial | null): void {
  state.player = {
    x: 0,
    z: 0,
    material,
    materialT: material ? 10 : 0,
    fuseMaterial: null,
    fuseT: 0,
    momSpeed: 8,
    momX: 1,
    momZ: 0,
    materialEmitT: 0,
    sprite: { mesh: {} },
  } as unknown as typeof state.player;
  state.zombies = [];
  state.floorFx = [];
  state.vfx = null;
  state.scene = { add() {}, remove() {} } as unknown as typeof state.scene; // spawnFloorFx needs a scene
  state.dbgMaterialEnabled = true;
  state.dbgMaterialOnBounce = true;
  state.dbgMaterialFloorFx = true;
  state.dbgMaterialTerrain = true;
}

describe("lava marble", () => {
  it("makes bumpers explosive (mult > 1), unlike stone which damps them", () => {
    setPlayer("lava");
    expect(materialBumperMult()).toBe(LAVA_BUMPER_MULT);
    expect(LAVA_BUMPER_MULT).toBeGreaterThan(1);
    setPlayer("stone");
    expect(materialBumperMult()).toBe(STONE_BUMPER_KICK_MULT);
    expect(STONE_BUMPER_KICK_MULT).toBeLessThan(1);
    setPlayer("water");
    expect(materialBumperMult()).toBe(1);
  });

  it("deposits a fire puddle on a fast bounce", () => {
    setPlayer("lava");
    expect(state.floorFx.length).toBe(0);
    emitMaterialOnBounce(-1, 0);
    expect(state.floorFx.length).toBe(1);
    expect(state.floorFx[0].kind).toBe("fire");
  });

  it("vaporizes oil into flame (terrain reaction), only as lava", () => {
    setPlayer("lava");
    expect(lavaVaporizesOil(0, 0)).toBe(true);
    expect(state.floorFx.some((fx) => fx.kind === "fire")).toBe(true);
    setPlayer("stone");
    expect(lavaVaporizesOil(0, 0)).toBe(false); // wrong material
  });

  it("no fire when the floor-fx layer is toggled off", () => {
    setPlayer("lava");
    state.dbgMaterialFloorFx = false;
    emitMaterialOnBounce(-1, 0);
    expect(state.floorFx.length).toBe(0);
  });
});

/**
 * THE BODY IS MADE OF MAGMA AND BASALT — a RATCHET on a measured regression.
 *
 * A census of the crushed lava body (scripts/marble-census.mjs) read:
 *
 *     lava  26:22.5%  27:17.5%  1:12.9%  0:10.1%  28:9.9%  24:5.4%  23:5.0%
 *
 * — leather shadow, leather dark, leather mid and two SKIN tones. Over 60% of
 * the ball was painted in the palette's furniture colours and the torch ramp
 * (14-18, the only warmth this palette has) did not appear at all. It rendered
 * as a varnished wooden pinwheel, and every attempt to fix that by animating
 * the seams harder was doomed, because the colour budget was the bug.
 *
 * This pins the SOURCE of that, which is the only part a unit test can see: the
 * skin's declared colours. The rendered result stays the census script's job —
 * run it after touching the crust treatment.
 */
describe("the lava skin's colour budget", () => {
  const torch = [14, 15, 16, 17, 18];
  const basalt = [0, 1, 2];
  const brown = [23, 24, 25, 26, 27, 28]; // skin + leather: the failure mode

  const rgbaOf = (i: number) => {
    const hex = PALETTE_HEX[i];
    return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
  };
  const usesAnyOf = (css: string, entries: number[]) => entries.some((i) => css.includes(rgbaOf(i)));

  it("spends the BODY ramp entirely on the torch ramp — no leather, no skin", () => {
    const skin = MARBLE_SKINS.lava;
    for (const stop of skin.ramp) {
      expect(usesAnyOf(stop, torch), `body stop ${stop} is not a torch entry`).toBe(true);
      expect(usesAnyOf(stop, brown), `body stop ${stop} is leather/skin — the pinwheel bug`).toBe(false);
    }
  });

  it("keeps its rim, accent and specular hot", () => {
    const skin = MARBLE_SKINS.lava;
    for (const [name, css] of [["rim", skin.rim], ["accent", skin.accent], ["spec", skin.spec]] as const) {
      expect(usesAnyOf(css, torch), `${name} is not a torch entry`).toBe(true);
    }
  });

  it("has a crust to glow against — the plates are painted near-black", () => {
    // The other half of the read: magma is only bright if the rock beside it is
    // dark. Read out of the painter SOURCE, because the plate colours are
    // literals inside `paintTreatment` and nothing exports them — a weaker
    // check than the census, and honest about being one: it can only catch the
    // exact regression that happened (plates painted in leather), which is
    // precisely the regression worth a ratchet.
    const src = readFileSync(new URL("../render/cel-painter.ts", import.meta.url), "utf8");
    const crust = src.slice(src.indexOf('case "crust"'), src.indexOf('case "crust"') + 4000);
    expect(crust.length).toBeGreaterThan(500); // the slice actually found the case
    expect(/ctx\.fillStyle = i % 2 === 0 \? pc\((?:0|1|2)\) : pc\((?:0|1|2)\)/.test(crust), "plates are not near-black").toBe(true);
    expect(/pc\(26\)/.test(crust), "the crust still paints leather shadow").toBe(false);
    expect(basalt.length).toBe(3);
  });
});
