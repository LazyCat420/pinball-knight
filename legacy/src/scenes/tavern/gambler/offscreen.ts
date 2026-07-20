/**
 * OFFSCREEN CANVAS SEAM.
 *
 * Both darts and roulette bake static art once into an offscreen canvas and blit
 * it per frame. Both need to do that under node-canvas in tests as well as in a
 * browser, so neither may call `document.createElement` directly.
 *
 * This is the one-line indirection that makes a bake testable: production passes
 * nothing and gets a DOM canvas, tests pass `createCanvas` from node-canvas.
 */

/** The minimum surface both a DOM canvas and node-canvas satisfy. */
export interface OffscreenLike {
  width: number;
  height: number;
  getContext(id: "2d"): unknown;
}

export type CanvasFactory = (w: number, h: number) => OffscreenLike;

/** Default factory. Tests inject node-canvas instead so the bake is checkable. */
export const domCanvasFactory: CanvasFactory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c as unknown as OffscreenLike;
};
