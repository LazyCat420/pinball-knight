/**
 * MARBLE FORMS — the wave that gave the six materials a BODY and finished the
 * behaviours they were named for.
 *
 * What these tests protect, in order of how badly each would fail in the wild:
 *
 *  1. The shadow EJECT. Phasing lets the ball sit inside masonry; if the
 *     material lapses while it is in there, the run is alive, unstuck-able and
 *     silent. This is the only failure here that costs a player their run.
 *  2. Wall erosion HANDING OFF at 1. The whole system is a middle state between
 *     "solid" and "open"; if the handoff never fires, lava scars walls forever
 *     and never opens one, which looks exactly like the feature working.
 *  3. The material CLIP. It is derived from the material name, so it cannot
 *     drift — but nothing about "the ball renders as the knight" throws, and
 *     that silence is what let the six ship without bodies in the first place.
 *  4. That diamond CUTS rather than rams, and that the difference is the
 *     cooldown, not the damage.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { state, type MarbleMaterial } from "../state";
import {
  materialClip,
  materialSquash,
  materialBreakSpeeds,
  materialCutsThrough,
  materialRamCooldown,
  materialContactKnockback,
  materialResistsDrain,
  materialPhasesWalls,
  shadowSlayerMult,
  squashScale,
  noteSquash,
  updateSquash,
  updatePhaseEject,
  MATERIAL_LIST,
} from "./marble";
import { erodeWallAt, wallErosionAt, resetWallErosion } from "./wall-erosion";
import { enterRicochetForm, updateRicochet, inRicochetForm, RICOCHET_FLAVORS } from "./ricochet-form";
import {
  STONE_WALL_BREAK_SPEED,
  STONE_SECRET_BREAK_SPEED,
  DIAMOND_WALL_BREAK_SPEED,
  DIAMOND_CUT_SPEED,
  DIAMOND_CUT_COOLDOWN,
  DIAMOND_CUT_KNOCKBACK,
  BALL_RAM_COOLDOWN,
  WATER_SQUASH,
  LAVA_SQUASH,
  SQUASH_MIN_SPEED,
  LAVA_MELT_PER_HIT,
} from "../constants";
import { setTile, at, type Grid } from "../engine/grid";
import { T_WALL, T_FLOOR } from "../maze/generator";

/** A square grid, every tile `fill`. Same shape the other suites build. */
function makeGrid(size: number, fill: number = T_FLOOR): Grid {
  return { w: size, h: size, t: new Uint8Array(size * size).fill(fill), shapes: new Uint8Array(size * size) };
}

function setMaterial(m: MarbleMaterial | null, speed = 0): void {
  state.dbgMaterialEnabled = true;
  state.player = {
    ...(state.player ?? {}),
    material: m,
    materialT: m ? 5 : 0,
    ironT: 0,
    momSpeed: speed,
    momX: 1,
    momZ: 0,
    x: 0,
    z: 0,
    hp: 5,
    iframes: 0,
    squashT: 0,
    squashAmp: 0,
    squashHx: 0,
    squashHy: 0,
    vampCdT: 0,
    phaseStuckT: 0,
    ricochetT: 0,
    ricochetFlavor: "bolt",
    ricochetTickT: 0,
    bounceCombo: 0,
  } as typeof state.player;
}

beforeEach(() => {
  setMaterial(null);
  state.grid = null;
  state.maze = null;
  state.vfx = null;
  state.zombies = [];
  state.level = 1;
  resetWallErosion();
});

// ── 1. Every material has a body ────────────────────────────────

describe("every material has its own painted body", () => {
  it("names a <material>ball clip for each, and none for a bare ball", () => {
    for (const m of MATERIAL_LIST) {
      setMaterial(m);
      expect(materialClip(), `${m} clip`).toBe(`${m}ball`);
    }
    setMaterial(null);
    // null, NOT "ball" — the caller falls through to steel/knight itself, and
    // returning a clip here would override Ball Form's chrome sphere.
    expect(materialClip()).toBeNull();
  });

  it("respects the debug kill switch — materials off restores the knight", () => {
    setMaterial("lava");
    expect(materialClip()).toBe("lavaball");
    state.dbgMaterialEnabled = false;
    expect(materialClip()).toBeNull();
    state.dbgMaterialEnabled = true;
  });
});

// ── 2. Squash: the fluid materials deform, the solid ones do not ──

describe("squash & stretch is what separates a fluid from a solid", () => {
  it("only water and lava deform at all", () => {
    const amps: Record<string, number> = {};
    for (const m of MATERIAL_LIST) {
      setMaterial(m);
      amps[m] = materialSquash();
    }
    expect(amps.water).toBe(WATER_SQUASH);
    expect(amps.lava).toBe(LAVA_SQUASH);
    // The CONTRAST is the mechanic: a diamond and a rock that squashed would
    // make "made of water" mean nothing.
    expect(amps.diamond).toBe(0);
    expect(amps.stone).toBe(0);
    expect(amps.storm).toBe(0);
    expect(amps.shadow).toBe(0);
  });

  /**
   * REGRESSION. The first squashScale blended the two screen-axis components
   * (`1 − d·|hx| + d·|hy|`), which cancels exactly when |hx| = |hy| — and this
   * camera is a 45° isometric, so EVERY axis-aligned world normal projects to
   * precisely that. Every wall in the maze is axis-aligned, so the squash was
   * silently a no-op in the only case that ever happens.
   *
   * Hence: the normals under test are world-axis-aligned on purpose. A version
   * of this test that fed a pre-projected screen normal would have passed
   * against the broken formula.
   */
  it("visibly deforms on an axis-aligned wall — the case that always happens", () => {
    for (const [nx, nz] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      setMaterial("water");
      noteSquash(nx, nz, SQUASH_MIN_SPEED * 3);
      const [sx, sy] = squashScale();
      const flat = Math.min(sx, sy);
      const bulge = Math.max(sx, sy);
      expect(flat, `normal (${nx},${nz}) did not flatten`).toBeLessThan(0.95);
      expect(bulge, `normal (${nx},${nz}) did not bulge`).toBeGreaterThan(1.05);
      // A ball that only squashed would read as SHRINKING on every hit.
      expect(sx * sy).toBeGreaterThan(0.9);
    }
  });

  it("ignores a gentle roll into a wall", () => {
    setMaterial("water");
    noteSquash(1, 0, SQUASH_MIN_SPEED - 1);
    expect(squashScale()).toEqual([1, 1]);
  });

  it("recovers to perfectly round", () => {
    setMaterial("water");
    noteSquash(1, 0, 20);
    for (let i = 0; i < 60; i++) updateSquash(1 / 60);
    expect(squashScale()).toEqual([1, 1]);
  });
});

// ── 3. Diamond CUTS; stone SMASHES ──────────────────────────────

describe("💎 diamond cuts rather than rams", () => {
  it("needs speed — a slow diamond is still just a ram", () => {
    setMaterial("diamond", DIAMOND_CUT_SPEED - 1);
    expect(materialCutsThrough()).toBe(false);
    expect(materialRamCooldown()).toBe(BALL_RAM_COOLDOWN);
  });

  it("the COOLDOWN is the mechanic, not the damage", () => {
    setMaterial("diamond", DIAMOND_CUT_SPEED + 5);
    expect(materialCutsThrough()).toBe(true);
    // A ram hits one clump and waits; a cut re-arms almost instantly, which is
    // what opens a LINE through a crowd rather than shoving its front rank.
    expect(materialRamCooldown()).toBe(DIAMOND_CUT_COOLDOWN);
    expect(materialRamCooldown()).toBeLessThan(BALL_RAM_COOLDOWN);
    // …and it does not shove: the foe is sliced where it stands.
    expect(materialContactKnockback()).toBe(DIAMOND_CUT_KNOCKBACK);
  });

  it("cannot be broken — the sapper's drain does not touch it", () => {
    setMaterial("diamond");
    expect(materialResistsDrain()).toBe(true);
    for (const m of ["water", "stone", "storm", "shadow", "lava"] as MarbleMaterial[]) {
      setMaterial(m);
      expect(materialResistsDrain(), `${m} is drainable`).toBe(false);
    }
  });
});

describe("🪨 stone smashes masonry by MASS, diamond by HARDNESS", () => {
  it("stone has its own thresholds, between diamond's and the bare ball's", () => {
    setMaterial("stone");
    const stone = materialBreakSpeeds();
    expect(stone.wall).toBe(STONE_WALL_BREAK_SPEED);
    expect(stone.secret).toBe(STONE_SECRET_BREAK_SPEED);
    // The invariant that keeps them from feeling like one material with two
    // skins: stone must have to be THROWN where diamond merely has to touch.
    expect(stone.wall).toBeGreaterThan(DIAMOND_WALL_BREAK_SPEED);
  });
});

// ── 4. Shadow: phase, slay, and ALWAYS get out ──────────────────

describe("🌑 shadow", () => {
  it("phases only while it is the active material", () => {
    setMaterial("shadow");
    expect(materialPhasesWalls()).toBe(true);
    setMaterial("stone");
    expect(materialPhasesWalls()).toBe(false);
  });

  it("slays the wall-phasing roster and nothing else", () => {
    setMaterial("shadow");
    for (const k of ["ghost", "reaper", "wisp"] as const) {
      expect(shadowSlayerMult(k), `${k}`).toBeGreaterThan(1);
    }
    expect(shadowSlayerMult("zombie")).toBe(1);
    expect(shadowSlayerMult("brute")).toBe(1);
    // …and only shadow gets it.
    setMaterial("storm");
    expect(shadowSlayerMult("ghost")).toBe(1);
  });

  /**
   * THE ONE THAT MATTERS. A run that ends sealed inside a wall is
   * unrecoverable and silent — no death, no message, just a ball that cannot
   * move. Phasing is only shippable because this net exists.
   */
  it("EJECTS the player when the material lapses inside a wall", () => {
    const g = makeGrid(9, T_WALL);
    setTile(g, 4, 6, T_FLOOR); // one walkable tile to be found
    state.grid = g;

    // Standing in solid rock with NO material — exactly the post-lapse state.
    setMaterial(null);
    state.player!.x = 0;
    state.player!.z = 0;
    const before = { x: state.player!.x, z: state.player!.z };

    // Grace first: a single frame of overlap must not teleport anyone.
    updatePhaseEject(1 / 60);
    expect(state.player!.x, "ejected inside the grace window").toBe(before.x);

    for (let i = 0; i < 30; i++) updatePhaseEject(1 / 60);
    expect(state.player!.x !== before.x || state.player!.z !== before.z).toBe(true);
  });

  it("does NOT eject while phasing is still active — that is the whole point", () => {
    const g = makeGrid(9, T_WALL);
    setTile(g, 4, 6, T_FLOOR);
    state.grid = g;
    setMaterial("shadow");
    state.player!.x = 0;
    state.player!.z = 0;
    for (let i = 0; i < 30; i++) updatePhaseEject(1 / 60);
    expect(state.player!.x).toBe(0);
    expect(state.player!.z).toBe(0);
  });
});

// ── 5. Wall erosion: the middle state ───────────────────────────

describe("🔥 wall erosion — masonry that takes PARTIAL damage", () => {
  beforeEach(() => {
    const g = makeGrid(9);
    setTile(g, 4, 4, T_WALL);
    state.grid = g;
    state.maze = null; // no mesh in a headless test; the paint path no-ops
  });

  it("accumulates without opening the wall", () => {
    expect(erodeWallAt(4, 4, 0.3)).toBe("eroded");
    expect(erodeWallAt(4, 4, 0.3)).toBe("eroded");
    expect(wallErosionAt(4, 4)).toBeCloseTo(0.6);
    // Still SOLID — that is the entire point of a middle state.
    expect(at(state.grid!, 4, 4)).toBe(T_WALL);
  });

  it("hands off to the smash at 1 — a scar that never opens is not a mechanic", () => {
    expect(erodeWallAt(4, 4, 0.6)).toBe("eroded");
    expect(erodeWallAt(4, 4, 0.6)).toBe("broken");
    // The handoff CLEARS the scar; leaving it would keep a phantom entry for a
    // tile that is now floor.
    expect(wallErosionAt(4, 4)).toBe(0);
  });

  it("takes several lava hits to breach — 'a little bit', not full damage", () => {
    let hits = 0;
    while (erodeWallAt(4, 4, LAVA_MELT_PER_HIT) === "eroded" && hits < 50) hits++;
    expect(hits).toBeGreaterThanOrEqual(3);
  });

  it("refuses the shell — melting the outer ring would open unbuilt space", () => {
    setTile(state.grid!, 0, 4, T_WALL);
    expect(erodeWallAt(0, 4, 5)).toBe("none");
  });

  it("ignores anything that is not masonry", () => {
    expect(erodeWallAt(2, 2, 0.5)).toBe("none");
  });

  it("drops its scars on a new floor — tile (4,4) is a different wall down there", () => {
    erodeWallAt(4, 4, 0.5);
    expect(wallErosionAt(4, 4)).toBeCloseTo(0.5);
    state.level = 2;
    expect(wallErosionAt(4, 4), "erosion carried across a descent").toBe(0);
  });
});

// ── 6. Ricochet form: one subsystem, two flavours ───────────────

describe("⚡/✨ ricochet form", () => {
  beforeEach(() => {
    const g = makeGrid(11);
    for (let i = 0; i < 11; i++) {
      setTile(g, i, 0, T_WALL);
      setTile(g, i, 10, T_WALL);
      setTile(g, 0, i, T_WALL);
      setTile(g, 10, i, T_WALL);
    }
    state.grid = g;
  });

  it("both flavours run 2-3 seconds — long enough to be a spectacle, short enough not to be a threat", () => {
    for (const spec of Object.values(RICOCHET_FLAVORS)) {
      expect(spec.duration).toBeGreaterThanOrEqual(2);
      expect(spec.duration).toBeLessThanOrEqual(3);
    }
  });

  it("owns the player for its duration, then hands control back", () => {
    setMaterial(null);
    enterRicochetForm("laser");
    expect(inRicochetForm()).toBe(true);
    // updateRicochet returning true is what makes updatePlayer bail — i.e. what
    // makes the form ignore input rather than merely dampen it.
    expect(updateRicochet(1 / 60)).toBe(true);
    for (let i = 0; i < 60 * 5; i++) updateRicochet(1 / 60);
    expect(inRicochetForm()).toBe(false);
    expect(updateRicochet(1 / 60)).toBe(false);
  });

  it("keeps the player invulnerable — you cannot steer out of trouble", () => {
    setMaterial(null);
    enterRicochetForm("bolt");
    state.player!.iframes = 0;
    updateRicochet(1 / 60);
    expect(state.player!.iframes).toBeGreaterThan(0);
  });

  it("never leaves the level, however wild the deflection", () => {
    setMaterial(null);
    enterRicochetForm("bolt");
    for (let i = 0; i < 60 * 3; i++) {
      updateRicochet(1 / 60);
      const { x, z } = state.player!;
      // Tunnelling out through a wall is the failure mode a fast swept move
      // invites; the sub-stepping in updateRicochet is what prevents it.
      expect(Math.abs(x), `escaped at frame ${i}`).toBeLessThan(6);
      expect(Math.abs(z), `escaped at frame ${i}`).toBeLessThan(6);
    }
  });

  it("launches even from a standstill", () => {
    setMaterial(null);
    state.player!.momX = 0;
    state.player!.momZ = 0;
    enterRicochetForm("bolt");
    expect(Math.hypot(state.player!.momX, state.player!.momZ)).toBeGreaterThan(0.5);
    const start = { x: state.player!.x, z: state.player!.z };
    for (let i = 0; i < 10; i++) updateRicochet(1 / 60);
    expect(Math.hypot(state.player!.x - start.x, state.player!.z - start.z)).toBeGreaterThan(0.1);
  });

  it("deflects RANDOMLY — a clean mirror path is the thing this must not be", () => {
    const headings = new Set<string>();
    for (const seed of [0.1, 0.4, 0.9]) {
      vi.spyOn(Math, "random").mockReturnValue(seed);
      setMaterial(null);
      state.player!.x = 0;
      state.player!.z = 0;
      state.player!.momX = 1;
      state.player!.momZ = 0;
      enterRicochetForm("bolt");
      for (let i = 0; i < 60; i++) updateRicochet(1 / 60);
      headings.add(`${state.player!.momX.toFixed(3)},${state.player!.momZ.toFixed(3)}`);
      vi.restoreAllMocks();
    }
    // Different jitter draws must produce different paths; if the deflection
    // were a plain reflection these would all collapse to one heading.
    expect(headings.size).toBeGreaterThan(1);
  });
});
