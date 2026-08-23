/**
 * THE MIRROR MUST MATCH.
 *
 * `engine/config.ts` carries defaults that duplicate `constants/render.ts` on
 * purpose: the engine does not import the game, so the two cannot be wired
 * together by a type. Its own comment has said "MUST mirror constants" since it
 * was split — with nothing enforcing it.
 *
 * That was survivable while both sides were frozen literals. It stopped being
 * survivable when the camera distance became a PLAYER SETTING, because the
 * game-side numbers now move with `CAMERA_ZOOM_DEFAULT` and the engine-side
 * ones do not follow on their own.
 *
 * The failure mode is the reason this file exists rather than a comment. The
 * GAME calls `installEngine()` at boot and overwrites these defaults, so play
 * is unaffected and a screenshot proves nothing. Only code that does NOT boot
 * the game reads them — which is every unit test. Drift therefore shows up as
 * art-census tests failing on numbers that look like art regressions and are
 * not: measured 2026-07-29, a mismatched mirror produced three failures across
 * two unrelated files (`crush-reuse`, `stiltneck`), none of which mentioned
 * configuration.
 */
import { describe, it, expect } from "vitest";
import { engineConfig } from "./config";
import {
  CAMERA_ZOOM_DEFAULT,
  CAMERA_ZOOMS,
  PPU,
  RENDER_W,
  RENDER_H,
  MAX_RENDER_W,
  MAX_RENDER_H,
  SPRITE_PX,
  SPRITE_PIXEL_GRID,
  SPRITE_UNITS,
  ART_PX,
  CEL_STEPS,
  CEL_SATURATION,
} from "../constants";

describe("engine defaults mirror the game constants", () => {
  it("carries the DEFAULT camera rung, not some other one", () => {
    // The engine's defaults describe a shipped configuration. They cannot track
    // a player's choice — they only have to agree with the one every fresh
    // install and every test gets.
    expect(engineConfig.camera.ppu).toBe(CAMERA_ZOOMS[CAMERA_ZOOM_DEFAULT]);
  });

  it("derives every sprite metric from that same rung", () => {
    const ppu = engineConfig.camera.ppu;
    expect(engineConfig.sprite.pixelGrid).toBe((ppu * 3) / 2);
    expect(engineConfig.sprite.px).toBe(ppu * 3);
    expect(engineConfig.sprite.units).toBe(3 / 2);
    // …and the derivation is the same one the game side uses, so a test that
    // reads `SPRITE_PX` from constants and a module that captured it from
    // engineConfig are looking at the same number.
    expect(engineConfig.sprite.pixelGrid).toBe(SPRITE_PIXEL_GRID);
    expect(engineConfig.sprite.px).toBe(SPRITE_PX);
    expect(engineConfig.sprite.units).toBe(SPRITE_UNITS);
    expect(engineConfig.sprite.artPx).toBe(ART_PX);
    expect(engineConfig.camera.ppu).toBe(PPU);
  });

  it("mirrors the render target bounds", () => {
    expect(engineConfig.post.renderW).toBe(RENDER_W);
    expect(engineConfig.post.renderH).toBe(RENDER_H);
    expect(engineConfig.post.maxRenderW).toBe(MAX_RENDER_W);
    expect(engineConfig.post.maxRenderH).toBe(MAX_RENDER_H);
  });

  it("mirrors the cel grade, which is the whole look and has no other guard", () => {
    // `pixel-pass.ts` destructures these at MODULE LOAD, before the game gets to
    // call installEngine() — so the shipped frame is graded with whatever the
    // mirror says, not with what constants/render.ts says. Drift here would not
    // fail a test or throw: it would just quietly ship a different look, which
    // is the one failure this suite cannot see and a player can.
    expect(engineConfig.post.celSteps).toBe(CEL_STEPS);
    expect(engineConfig.post.celSaturation).toBe(CEL_SATURATION);
  });
});
