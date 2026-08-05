/**
 * THE FRAME STATS DESCRIBE THE RIGHT KIND OF SLOW.
 *
 * A p95 alone cannot separate a uniformly slow game from a smooth one that
 * hitches — and those need opposite fixes, which is the whole reason
 * `FrameStats` carries jank and stutter shares alongside the percentiles.
 * This pins that distinction with two synthetic runs whose p50s are identical
 * and whose player experience is not.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FRAME_BUDGET_MS,
  getFrameStats,
  getP95FrameMs,
  installProfilerHooks,
  profBegin,
  profEnd,
  profFrame,
} from "./profiler";

/**
 * Drive the real profiler for one run of the given whole-frame times.
 *
 * `performance.now` is faked so a frame can "take" exactly what the case needs
 * — the alternative is sleeping for real, which would make this test take
 * minutes and still not produce an exact distribution.
 */
function runFrames(times: number[]): void {
  let clock = 0;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
  // The hooks install onto `window` and no-op without one; node has no window.
  // A bare self-reference is enough — `start`/`stop` only reach through it for
  // the console hooks and the viewport line.
  const g = globalThis as unknown as Record<string, unknown>;
  const hadWindow = "window" in g;
  if (!hadWindow) g.window = g;
  installProfilerHooks();
  (g.__dungeonProfile as (n: number) => string)(times.length);
  for (const ms of times) {
    profBegin("FRAME (total)");
    clock += ms;
    profEnd("FRAME (total)");
    profFrame();
  }
  spy.mockRestore();
}

afterEach(() => vi.restoreAllMocks());

describe("frame stats", () => {
  it("separates a uniformly slow run from a hitching one", () => {
    // 100 frames at a steady 20ms: every frame misses 60fps, none stutters.
    runFrames(Array.from({ length: 100 }, () => 20));
    const slow = getFrameStats();
    expect(slow?.p50).toBe(20);
    expect(slow?.jankPct).toBe(100);
    expect(slow?.stutterPct).toBe(0);

    // 100 frames at a comfortable 8ms with four 50ms hitches. The average is
    // fine, the p50 is BETTER than the slow run's — and the player sees four
    // visible stutters. A p95-only gate is what misses this.
    const hitchy = Array.from({ length: 100 }, (_, i) => (i % 25 === 0 ? 50 : 8));
    runFrames(hitchy);
    const jumpy = getFrameStats();
    expect(jumpy?.p50).toBe(8);
    expect(jumpy?.p50).toBeLessThan(slow!.p50);
    expect(jumpy?.stutterPct).toBeGreaterThan(0);
    expect(jumpy?.worst).toBe(50);
    // p99 sees the hitch; p50 never does.
    expect(jumpy?.p99).toBeGreaterThan(FRAME_BUDGET_MS * 2);
  });

  it("reports exact percentiles and keeps p95FrameMs agreeing with them", () => {
    runFrames([...Array.from({ length: 95 }, () => 10), ...Array.from({ length: 5 }, () => 40)]);
    const f = getFrameStats();
    expect(f?.n).toBe(100);
    expect(f?.p50).toBe(10);
    expect(f?.worst).toBe(40);
    expect(f?.jankPct).toBe(5);
    // The legacy single number must not drift from the distribution it came from.
    expect(getP95FrameMs()).toBe(f?.p95);
  });
});
