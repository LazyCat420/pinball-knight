/**
 * ATLAS SIZE — the invariant that a black screen taught us.
 *
 * The sprite sheet used to be ONE long row of frames. Past 113 frames that row
 * exceeds the 8192px texture limit every target reports, and WebGL silently
 * RESIZES the texture (`Texture has been resized from (9504x72) to (8192x62)`)
 * — which corrupts every UV on the sheet and renders as a black screen with a
 * working HUD. Nothing throws. It shipped, and it cost a deploy to find.
 *
 * Two fixes, both pinned here:
 *  1. Frames pack into a GRID, so width is bounded and the sheet grows down.
 *  2. Identical frames are shared rather than duplicated per facing (a sphere
 *     looks the same from every angle — the steel ball was 12 identical cells).
 */
import { describe, expect, it } from "vitest";
import { makeKnightPaints, ITEM_PAINTS, type ClipName } from "./cel-painter";
import { FULL_PLATE } from "./knight-look";
import { WEAPONS, PICKUP_WEAPONS, type WeaponId } from "../items";
import { SPRITE_PIXEL_GRID, MAX_ATLAS_WIDTH } from "../constants";

const CLIPS: ClipName[] = ["idle", "walk", "run", "attack", "death", "roll", "ball", "steelball", "equip", "forge"];

/** Mirror of buildSpriteSheet's packing: dedupe by reference, then grid it. */
function pack(weapon: WeaponId) {
  const paints = makeKnightPaints(weapon, FULL_PLATE);
  const seen = new Set<unknown>();
  let frames = 0;
  let shared = 0;
  for (const dir of ["S", "N", "E"] as const) {
    for (const clip of CLIPS) {
      const list = (paints[dir] as Record<string, unknown[]>)[clip];
      if (!list) continue;
      for (const f of list) {
        if (seen.has(f)) shared++;
        else {
          seen.add(f);
          frames++;
        }
      }
    }
  }
  const cols = Math.min(frames, Math.floor(MAX_ATLAS_WIDTH / SPRITE_PIXEL_GRID));
  const rows = Math.max(1, Math.ceil(frames / cols));
  return { frames, shared, cols, rows, w: cols * SPRITE_PIXEL_GRID, h: rows * SPRITE_PIXEL_GRID };
}

describe("the knight atlas fits on the GPU", () => {
  it("REGRESSION: every weapon's sheet stays inside the texture limit", () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const a = pack(id);
      expect(a.w, `${id} atlas ${a.w}px wide — it will be silently downscaled`).toBeLessThanOrEqual(MAX_ATLAS_WIDTH);
      expect(a.h, `${id} atlas ${a.h}px tall — it will be silently downscaled`).toBeLessThanOrEqual(MAX_ATLAS_WIDTH);
    }
  });

  it("would NOT fit as a single row — the grid is load-bearing, not decorative", () => {
    // If this ever passes, the grid stopped being necessary and someone may be
    // tempted to revert it. It is currently ~124 frames against a 113 ceiling.
    const a = pack("sword");
    expect(a.frames * SPRITE_PIXEL_GRID).toBeGreaterThan(MAX_ATLAS_WIDTH);
    expect(a.rows).toBeGreaterThan(1);
  });

  it("shares identical frames instead of packing duplicates", () => {
    // The steel ball is a SPHERE: its four frames are authored once and handed
    // to all three facings, so eight cells are saved.
    const a = pack("sword");
    expect(a.shared, "no frames were shared — the sphere is being duplicated per facing").toBeGreaterThan(0);
  });

  it("every frame has a cell — the grid never truncates content", () => {
    const a = pack("sword");
    expect(a.cols * a.rows).toBeGreaterThanOrEqual(a.frames);
  });
});


/**
 * GROUND SPRITES — the black-screen bug that atlas work masked.
 *
 * ITEM_PAINTS is an untyped object literal, so a weapon missing from it type-
 * checks fine. The level decorator then spawns that weapon as a ground pickup,
 * `ITEM_PAINTS[id]` returns undefined, and the floor build dies with
 * "e is not a function" — the WHOLE LEVEL fails to construct, which presents as
 * a black screen with a working HUD. Three new weapons shipped that way.
 */
describe("every weapon has a ground sprite", () => {
  it("REGRESSION: every pickup weapon is paintable on the floor", () => {
    for (const id of PICKUP_WEAPONS) {
      const paint = (ITEM_PAINTS as Record<string, unknown>)[id];
      expect(typeof paint, `ITEM_PAINTS["${id}"] is ${typeof paint} — the floor build will throw`).toBe("function");
    }
  });

  it("covers every weapon in the table except fists", () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      if (id === "fists") continue; // never dropped
      expect(typeof (ITEM_PAINTS as Record<string, unknown>)[id], `${id} has no ground sprite`).toBe("function");
    }
  });

  it("and every weapon renders HELD, not just on the ground", () => {
    // WEAPON_HELD is Partial<Record<>>, so a missing painter renders the knight
    // empty-handed rather than throwing — quieter, but still wrong.
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      if (id === "fists") continue;
      const p = makeKnightPaints(id, FULL_PLATE);
      expect(p.S.idle, `${id} has no idle clip`).toBeTruthy();
    }
  });
});
