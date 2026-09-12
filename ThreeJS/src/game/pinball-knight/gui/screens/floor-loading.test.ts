/**
 * THE DESCENT SCREEN'S FRAME COST — the property, not a stopwatch.
 *
 * This screen is on display exactly while the thread is blocked building a
 * floor, so anything it spends comes out of the budget it exists to cover. The
 * version this replaced walked every cell of the labyrinth every frame: about
 * 2,400 `fillRect`s at 1600x900, each one preceded by a freshly built
 * `rgba(...)` string for the canvas to re-parse. It got slower the bigger the
 * player's window was, which is backwards.
 *
 * A timing assertion here would be a flake on a shared box (`npm test` runs
 * beside everything else on this machine), so what is pinned is the SHAPE of
 * the work instead:
 *
 *   · a steady frame issues a small, bounded number of canvas calls, and
 *   · that number does not grow when the field does.
 *
 * Quadrupling the area and requiring the call count to stay put is what makes
 * this a real test rather than a number somebody can re-baseline: the old paint
 * would have gone up by ~4x on the second case and failed loudly.
 *
 * The labyrinth being pre-rendered is pinned the same way — by counting the
 * canvases the screen allocates across a run of frames, which is two per size
 * change and none after.
 *
 * DOM-free vitest environment, so `document` is shimmed with node-canvas.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createCanvas } from "canvas";

const realDoc = (globalThis as { document?: unknown }).document;
const realPerf = globalThis.performance;
let canvasesMade = 0;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => {
      if (t !== "canvas") return {};
      canvasesMade++;
      return createCanvas(8, 8);
    },
    head: { appendChild: () => {} },
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
  (globalThis as { performance?: unknown }).performance = realPerf;
});

/** Canvas calls, by method name, for one painted frame. */
interface Counts {
  total: number;
  byName: Map<string, number>;
}

/**
 * A context that records what was asked of it and then does it for real.
 *
 * Real, not a stub: a stub that silently accepts everything would let a paint
 * that throws in a browser pass here, and the clip this screen relies on has to
 * actually clip for the frame to be worth counting.
 *
 * ⚠️ Both traps hand `this` to the REAL context, deliberately. node-canvas
 * implements `fillStyle`, `imageSmoothingEnabled` and friends as native
 * accessors that reject any receiver but their own object: forwarding the proxy
 * as the receiver (the default `Reflect.get(t, k, recv)`) makes every one of
 * them throw `Invalid argument`, from a line that has nothing to do with the
 * proxy. Same rule for the setter.
 */
function counting(g: CanvasRenderingContext2D, counts: Counts): CanvasRenderingContext2D {
  return new Proxy(g, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const name = String(prop);
        counts.total++;
        counts.byName.set(name, (counts.byName.get(name) ?? 0) + 1);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
    set(target, prop, value) {
      (target as unknown as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  }) as CanvasRenderingContext2D;
}

async function paintOnce(w: number, h: number, frames: number): Promise<{ counts: Counts; canvases: number }> {
  const { openFloorLoading, DESIGN } = await import("./floor-loading");
  const { screens } = await import("../stack");
  const { beginUi, emptyUiInput } = await import("../im");
  const { presentationZoom } = await import("../root");

  const canvas = createCanvas(w, h);
  const raw = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  let now = 0;
  (globalThis as { performance?: unknown }).performance = { now: () => now };

  const handle = openFloorLoading(4);
  const screen = screens()[screens().length - 1];
  const zoom = presentationZoom(DESIGN, w, h);
  const counts: Counts = { total: 0, byName: new Map() };

  const draw = (g: CanvasRenderingContext2D): void => {
    const f = beginUi(g, Math.floor(w / zoom), Math.floor(h / zoom), emptyUiInput(), 0, false, zoom);
    screen.paint(f, screen);
  };

  // The first paint builds the labyrinth; it is not what is being counted.
  now = 10;
  draw(raw);
  const afterFirst = canvasesMade;

  for (let i = 0; i < frames; i++) {
    now = 100 + i * 16;
    draw(i === frames - 1 ? counting(raw, counts) : raw);
  }
  const canvases = canvasesMade - afterFirst;
  handle.close();
  return { counts, canvases };
}

describe("the descent screen's frame", () => {
  beforeEach(() => {
    canvasesMade = 0;
  });

  it("issues a bounded number of canvas calls, and blits the labyrinth", async () => {
    const { counts } = await paintOnce(1600, 900, 12);
    expect(counts.total).toBeLessThan(150);
    // Two blits: the cold field, and the lit one over the swept part.
    expect(counts.byName.get("drawImage")).toBe(2);
  });

  it("does not get more expensive as the field gets bigger", async () => {
    // ⚠️ THE TWO SIZES MUST SHARE A ZOOM, or this test proves nothing. The UI
    // zoom grows with the window (`presentationZoom`), and a cell is sized in
    // UI pixels — so 800x450 actually holds MORE cells than 1600x900 does, and
    // comparing those two would let a per-cell paint pass. Both of these sit on
    // the screen's 3x ceiling, so the second really is 2.25x the labyrinth.
    const { DESIGN } = await import("./floor-loading");
    const { presentationZoom } = await import("../root");
    expect(presentationZoom(DESIGN, 2400, 1350)).toBe(presentationZoom(DESIGN, 1600, 900));

    const small = await paintOnce(1600, 900, 12);
    const big = await paintOnce(2400, 1350, 12);
    expect(big.counts.total).toBeLessThan(small.counts.total * 1.35 + 8);
  });

  it("paints the labyrinth ONCE, not once a frame", async () => {
    // Two layers on the first paint, and nothing after it. A regression here is
    // the whole bug back again, just hidden one level down.
    const { canvases } = await paintOnce(1200, 700, 30);
    expect(canvases).toBe(0);
  });

  it("leaves the frame opaque, so a half-built floor cannot show through", async () => {
    const { openFloorLoading, DESIGN } = await import("./floor-loading");
    const { screens } = await import("../stack");
    const { beginUi, emptyUiInput } = await import("../im");
    const { presentationZoom } = await import("../root");

    const w = 900;
    const h = 500;
    const canvas = createCanvas(w, h);
    const g = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    (globalThis as { performance?: unknown }).performance = { now: () => 1200 };
    const handle = openFloorLoading(2);
    const screen = screens()[screens().length - 1];
    const zoom = presentationZoom(DESIGN, w, h);
    const f = beginUi(g, Math.floor(w / zoom), Math.floor(h / zoom), emptyUiInput(), 0, false, zoom);
    screen.paint(f, screen);
    handle.close();

    const { data } = g.getImageData(0, 0, w, h);
    let clear = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) clear++;
    expect(clear).toBe(0);
  });
});
