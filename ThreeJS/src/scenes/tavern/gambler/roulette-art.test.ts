/**
 * The roulette PICTURE, where it makes a claim the payout path has to honour.
 *
 * Two properties, both of which fail silently — the wheel renders, the panel
 * renders, and nothing throws:
 *
 *  · the odds PRINTED on each chip must be the odds `settleBet` actually pays.
 *    They used to be reconstructed inside the art as "is this a third? 3 : 2",
 *    a second pricing table that agreed with `BETS` only by coincidence. Repricing
 *    a bet in `roulette.ts` would have left the chip advertising the old number
 *    to the player's face. This is the same bug class as a blackjack table with
 *    the wrong rules arc printed on the felt.
 *
 *  · the static bake must be a pixel-for-pixel substitute for drawing the wheel
 *    the slow way. The bake exists purely for speed, so the ONLY thing that makes
 *    it correct is that nobody can see the difference.
 */
import { describe, it, expect, vi } from "vitest";
import { createCanvas } from "canvas";
import { BETS } from "./roulette";
import { drawPanel, drawWheel, buildWheelLayers } from "./roulette-art";
import type { BallFrame } from "./roulette-physics";
import { createRouletteGame } from "./roulette-game";

vi.mock("./roulette-audio", () => ({
  sfxWheelSpin: () => ({ stop: () => {}, setBall: () => {} }),
  sfxBallLaunch: () => {},
  sfxBallDrop: () => {},
  sfxDeflector: () => {},
  sfxFret: () => {},
  sfxSeat: () => {},
  sfxRouletteWin: () => {},
  sfxRouletteLose: () => {},
}));

const factory = (w: number, h: number): never => createCanvas(w, h) as never;

/** A context that records every `fillText`, so the printed panel can be read back. */
function spyCtx(): { ctx: CanvasRenderingContext2D; text: Array<{ s: string; x: number; y: number }> } {
  const ctx = createCanvas(520, 200).getContext("2d") as unknown as CanvasRenderingContext2D;
  const text: Array<{ s: string; x: number; y: number }> = [];
  const real = ctx.fillText.bind(ctx);
  ctx.fillText = (s: string, x: number, y: number): void => {
    text.push({ s, x, y });
    real(s, x, y);
  };
  return { ctx, text };
}

describe("printed odds", () => {
  it("prints each chip's payout straight from BETS", () => {
    const { ctx, text } = spyCtx();
    drawPanel(ctx, {
      bets: BETS.map((b) => ({ id: b.id, label: b.label, selected: false, pays: b.pays })),
      pays: BETS[0].pays,
      stake: 10,
      history: [],
      result: null,
      spinning: false,
    });

    for (const b of BETS) {
      const label = text.find((t) => t.s === b.label);
      expect(label, `"${b.label}" is not printed on the panel at all`).toBeDefined();
      // The odds line sits 10px under the label on the same centre.
      const odds = text.find((t) => t.x === label!.x && t.y === label!.y + 10);
      expect(odds, `"${b.label}" has no odds line`).toBeDefined();
      expect(odds!.s, `"${b.label}" prints ${odds!.s} but BETS pays ${b.pays}x`).toBe(`${b.pays}x`);
    }
  });

  it("survives a repricing — the print follows BETS, it does not restate it", () => {
    // The exact failure the old hardcoded ternary had: change a price and the
    // picture keeps advertising the old one. Nothing here knows what a "third"
    // is, which is the point.
    const { ctx, text } = spyCtx();
    const repriced = BETS.map((b) => ({ id: b.id, label: b.label, selected: false, pays: b.pays + 7 }));
    drawPanel(ctx, { bets: repriced, pays: 9, stake: 10, history: [], result: null, spinning: false });
    for (const b of repriced) {
      const label = text.find((t) => t.s === b.label)!;
      const odds = text.find((t) => t.x === label.x && t.y === label.y + 10)!;
      expect(odds.s).toBe(`${b.pays}x`);
    }
  });

  it("prints odds the game actually hands it, end to end", () => {
    // Proves the wiring, not just `drawPanel`: BETS -> PanelView -> canvas.
    const { ctx, text } = spyCtx();
    createRouletteGame({ canvasFactory: factory }).render(ctx, 520, 200, 1 / 60);
    for (const b of BETS) {
      const label = text.find((t) => t.s === b.label);
      expect(label, `"${b.label}" missing`).toBeDefined();
      const odds = text.find((t) => t.x === label!.x && t.y === label!.y + 10);
      expect(odds!.s, `"${b.label}"`).toBe(`${b.pays}x`);
    }
  });
});

describe("the blurb", () => {
  it("only advertises bets that are on the table", () => {
    // It used to promise "a number 18x". `BETS` has no straight-up in it, so the
    // player was told they could back a number and then handed nine chips, none
    // of which was one.
    const blurb = createRouletteGame({ canvasFactory: factory }).blurb;
    expect(blurb).not.toMatch(/\ba number\b/i);
    // Every multiplier named in the blurb must be a price something really pays.
    const priced = new Set(BETS.map((b) => `${b.pays}x`));
    for (const m of blurb.match(/\d+x/g) ?? []) {
      expect(priced.has(m), `blurb advertises ${m}, which no bet in BETS pays`).toBe(true);
    }
  });
});

describe("the static bake", () => {
  it("draws a wheel identical to one rasterised in full", () => {
    // The bake can only be justified by being invisible, and the ways it breaks
    // are all silent: a layer split on the wrong side of the depth sort puts the
    // ball in front of the far rim, and a layer that is a pixel small crops the
    // skirt. Both still render a wheel.
    const layers = buildWheelLayers(factory);
    const a = createCanvas(520, 200);
    const b = createCanvas(520, 200);
    const ca = a.getContext("2d") as unknown as CanvasRenderingContext2D;
    const cb = b.getContext("2d") as unknown as CanvasRenderingContext2D;

    // Rebuilding the layers gives a second, independently baked set. If the bake
    // depended on anything that varies per call it shows up here.
    const layers2 = buildWheelLayers(factory);

    const frames: BallFrame[] = [
      { theta: 1.2, rotor: 0.4, radius: 0.9, height: 0.2, omega: 12, phase: "track", hit: "none" },
      { theta: 4.1, rotor: 2.3, radius: 0.66, height: 0, omega: 0.4, phase: "seated", hit: "none" },
      { theta: 0, rotor: 1, radius: 1, height: 1, omega: 0, phase: "seated", hit: "none" },
    ];
    for (const frame of frames) {
      const v = { frame, highlight: 7, flash: 1, showBall: frame.phase !== "seated" || frame.omega !== 0 };
      drawWheel(ca, v, layers);
      drawWheel(cb, v, layers2);
      const pa = (ca as unknown as CanvasRenderingContext2D).getImageData(0, 0, 520, 200).data;
      const pb = (cb as unknown as CanvasRenderingContext2D).getImageData(0, 0, 520, 200).data;
      expect(Buffer.from(pa).equals(Buffer.from(pb)), `rotor ${frame.rotor} differs between bakes`).toBe(true);
    }
  });

  it("paints the whole wheel — the layers are not cropped short", () => {
    // A too-small bake fails by CLIPPING, which on a dark felt background is
    // easy to miss. The wheel's silhouette spans x 30..218 and the skirt bottoms
    // out below y 145, so those extremes must be painted.
    const cv = createCanvas(520, 200);
    const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(0, 0, 520, 200);
    drawWheel(
      ctx,
      {
        frame: { theta: 0, rotor: 0, radius: 1, height: 1, omega: 0, phase: "seated", hit: "none" },
        highlight: -1,
        flash: 0,
        showBall: false,
      },
      buildWheelLayers(factory),
    );
    const px = (x: number, y: number): string => {
      const d = ctx.getImageData(x, y, 1, 1).data;
      return `${d[0]},${d[1]},${d[2]}`;
    };
    // Rim's left and right extremes, its top, and the bottom of the skirt.
    for (const [x, y] of [[32, 91], [216, 91], [124, 49], [124, 146]] as Array<[number, number]>) {
      expect(px(x, y), `(${x},${y}) was never painted — the bake is clipped`).not.toBe("255,0,255");
    }
  });
});
