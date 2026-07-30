/**
 * A CANVAS WITH NO BACKING STORE CANNOT BE UPLOADED.
 *
 * The error this prevents, logged on every dungeon load under WebGPU:
 *
 *   CopyExternalImageToTexture(): Browser fails extracting valid resource from
 *   external image. This API call will return early.
 *
 * A fresh (or freshly resized) canvas has no resource until something paints
 * into it, and two canvases here are bound as textures before anything does:
 * the damage-number pool's slot 0 (it IS `warmupTarget()`, handed to
 * `compileAsync` by the descent prewarm) and the UI layer after `syncSize`.
 *
 * The subtle part — and the reason this is a test and not a one-liner — is that
 * the paint must be a REAL one. A transparent fill is a legal no-op that a
 * browser may elide, and eliding it leaves the canvas exactly as resource-less
 * as it started, which is the bug wearing a fix's clothes.
 */
import { describe, expect, it } from "vitest";
import { forceBackingStore } from "./canvas-backing";

interface Op {
  op: string;
  args: unknown[];
}

/** A canvas stub that records what was drawn. No jsdom in this suite. */
function fakeCanvas(width = 128, height = 64, ctx: Partial<CanvasRenderingContext2D> | null = {}) {
  const ops: Op[] = [];
  const record =
    (op: string) =>
    (...args: unknown[]) =>
      void ops.push({ op, args });
  const context =
    ctx === null
      ? null
      : ({
          save: record("save"),
          restore: record("restore"),
          fillRect: record("fillRect"),
          clearRect: record("clearRect"),
          set fillStyle(v: string) {
            ops.push({ op: "fillStyle", args: [v] });
          },
          ...ctx,
        } as unknown as CanvasRenderingContext2D);
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, ops };
}

describe("forceBackingStore", () => {
  it("paints something OPAQUE — a transparent no-op can be elided", () => {
    const { canvas, ops } = fakeCanvas();
    forceBackingStore(canvas);
    const fill = ops.findIndex((o) => o.op === "fillRect");
    expect(fill, "nothing was ever painted, so no resource is allocated").toBeGreaterThanOrEqual(0);
    const style = ops.find((o) => o.op === "fillStyle");
    expect(style?.args[0], "the fill must not be transparent").toBe("#000000");
  });

  it("leaves the surface fully transparent — it must not be visible", () => {
    const { canvas, ops } = fakeCanvas(128, 64);
    forceBackingStore(canvas);
    const fill = ops.findIndex((o) => o.op === "fillRect");
    const clear = ops.findIndex((o) => o.op === "clearRect");
    expect(clear, "the opaque pixel was never wiped").toBeGreaterThan(fill);
    expect(ops[clear].args, "the clear must cover the WHOLE canvas").toEqual([0, 0, 128, 64]);
  });

  it("restores context state — layer.ts shares one context with every screen", () => {
    // Leaving fillStyle black behind would surface as one wrong-coloured panel
    // in a file that never touched this one.
    const { canvas, ops } = fakeCanvas();
    forceBackingStore(canvas);
    expect(ops[0].op).toBe("save");
    expect(ops[ops.length - 1].op).toBe("restore");
  });

  it("is a no-op when there is no 2D context, rather than throwing", () => {
    const { canvas } = fakeCanvas(4, 4, null);
    expect(() => forceBackingStore(canvas)).not.toThrow();
  });
});
