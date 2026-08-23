/**
 * THE DESCENT SCREEN MUST REACH THE SCREEN.
 *
 * This suite exists for one bug, and it is worth stating precisely because
 * every part of the system looked healthy while it was live:
 *
 *   · the screen was pushed onto the UI stack             ✓
 *   · `isFloorLoadingOpen()` answered true                ✓
 *   · its `paint` was correct, its bar was wall-clocked   ✓
 *   · `__gui().screens` listed it                         ✓
 *   · and the player saw BLACK for the whole descent.
 *
 * Because the canvas UI is painted BY THE FRAME LOOP, and the frame loop is
 * deliberately held during a descent so the floor's pipelines can be compiled
 * in batches instead of all landing on frame one. `loop()` opened with a bare
 * `return` while held — correct when the descent screen was a DOM overlay the
 * browser composited independently, fatal the moment it moved onto the canvas.
 *
 * So "the screen is open" is NOT the property to assert. The property is "a
 * frame carrying it was presented", and these tests assert that at both seams
 * that can lose it:
 *
 *   1. `armFloorLoading` — the two frames bought before `buildLevel` blocks the
 *      thread. On the first descent of a session there is no running loop at
 *      all (the tavern has just disposed its renderer), so if these two frames
 *      do not present, nothing does.
 *   2. `loop()`'s held branch — the several seconds of `warmFloorPipelines`.
 *
 * The second is asserted against the SOURCE. `sim/loop.ts` pulls in three, the
 * whole entity system and the profiler; standing that up to observe one early
 * return would be a worse test than reading the branch, and the regression this
 * guards against is textually specific — someone tidying the present call back
 * out of an early return.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const presentUiFrame = vi.fn(() => true);
const openFloorLoading = vi.fn(() => ({ phase: vi.fn(), close: vi.fn() }));

vi.mock("../boot/renderer", () => ({ presentUiFrame: () => presentUiFrame() }));
vi.mock("../floor-loading", () => ({ openFloorLoading: (...a: unknown[]) => openFloorLoading(...(a as [])) }));

import { armFloorLoading, isRenderHeld, currentFloorLoad, releaseFloorLoad } from "./floor-hold";
import { state } from "../state";

/**
 * A hand-driven rAF queue. Frames only advance when a test says so, which is
 * the whole point: the ORDER of "present" against "then" is the contract, and a
 * real rAF would let the assertion race the callback it is about.
 */
let pending: FrameRequestCallback[] = [];
function flushFrame(): void {
  const due = pending;
  pending = [];
  for (const cb of due) cb(0);
}

beforeEach(() => {
  presentUiFrame.mockClear();
  openFloorLoading.mockClear();
  pending = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending.push(cb);
    return pending.length;
  });
  state.container = {} as HTMLDivElement;
  releaseFloorLoad(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  state.container = null;
  releaseFloorLoad(null);
});

describe("armFloorLoading", () => {
  it("presents a frame before the continuation is allowed to block the thread", () => {
    const then = vi.fn();
    armFloorLoading(4, then);

    // Nothing has been presented yet and — critically — `then` has NOT run.
    // It is the caller that blocks for ~544ms inside buildLevel.
    expect(presentUiFrame).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();

    flushFrame();
    expect(presentUiFrame).toHaveBeenCalledTimes(1);
    expect(then).not.toHaveBeenCalled();

    flushFrame();
    // TWO presents, then the build. The second is not superstition: GPU
    // submission is async, so the first frame is only QUEUED when it returns.
    // The second gives the compositor a turn to actually put it up, which is
    // the difference the player sees.
    expect(presentUiFrame).toHaveBeenCalledTimes(2);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("raises the hold and the screen synchronously, before any frame elapses", () => {
    // The hold must be up on the same tick, or a rAF that fires between the
    // call and the first frame would render the half-torn-down floor.
    armFloorLoading(4, vi.fn());
    expect(isRenderHeld()).toBe(true);
    expect(currentFloorLoad()).not.toBeNull();
    expect(openFloorLoading).toHaveBeenCalledWith(state.container, 4);
  });

  it("runs the continuation straight through when there is no container", () => {
    // The headless harness has no container. It must not be stranded waiting
    // for frames that nothing will ever produce.
    state.container = null;
    const then = vi.fn();
    armFloorLoading(4, then);
    expect(then).toHaveBeenCalledTimes(1);
    expect(isRenderHeld()).toBe(false);
    expect(presentUiFrame).not.toHaveBeenCalled();
  });
});

describe("the held branch of the frame loop", () => {
  const LOOP = readFileSync(join(__dirname, "..", "sim", "loop.ts"), "utf8");

  it("still presents the UI instead of returning outright", () => {
    const branch = LOOP.match(/if\s*\(isRenderHeld\(\)\)\s*\{[\s\S]*?\n\s{2}\}/);
    // Anti-vacuity: a source rule whose pattern stops matching passes forever
    // while protecting nothing (the lesson `no-dom.test.ts` and
    // `core-boundary.test.ts` both bake in).
    expect(branch, "the held branch in sim/loop.ts was not found — this rule is not testing anything").not.toBeNull();
    expect(branch?.[0]).toContain("presentUiFrame()");
  });

  it("does not render the scene while held — that is what the hold is FOR", () => {
    // If this ever fails, the pipeline compile storm `warmFloorPipelines`
    // schedules has come back and the descent will end in a multi-second freeze.
    const branch = LOOP.match(/if\s*\(isRenderHeld\(\)\)\s*\{[\s\S]*?\n\s{2}\}/);
    expect(branch?.[0]).not.toContain("pixelPass.render");
  });
});

describe("presentUi", () => {
  const PASS = readFileSync(join(__dirname, "..", "engine", "render", "pixel-pass.ts"), "utf8");
  const body = PASS.match(/function presentUi\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? "";

  it("exists and never touches the scene", () => {
    expect(body, "presentUi() was not found in pixel-pass.ts").not.toBe("");
    // `blit` renders a full-screen quad through its own material; anything that
    // named a scene here would be drawing the floor and defeating the hold.
    expect(body).not.toMatch(/renderer\.render\(\s*scene/);
    expect(body).toContain("blit(finalMat, null)");
  });

  it("clears BOTH sources the composite samples", () => {
    // The UI layer covers the grid only to floor(grid / zoom) * zoom, so a
    // screen at a zoom that does not divide the grid leaves a margin of one or
    // two pixels. Uncleared, that margin shows a strip of the floor that was
    // just torn down — and the bloom target smears a blurred copy of it.
    expect(body).toContain("sceneTarget");
    expect(body).toContain("bloomA");
    expect(body.match(/renderer\.clear\(\)/g)?.length).toBe(2);
  });
});
