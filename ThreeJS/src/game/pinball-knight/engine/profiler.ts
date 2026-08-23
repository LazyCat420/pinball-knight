/**
 * Frame profiler — a zero-cost-when-off timing harness for the dungeon loop.
 *
 * WHY THIS EXISTS. "The game lags" is not actionable: the frame is a long chain
 * of sim steps, presentation updates and a multi-pass render, and the guilty
 * stage is rarely the one you would guess. (The wall-bounce jitter everyone
 * assumed was the renderer turned out to be DOM node accumulation.) This module
 * measures each stage so the next optimisation targets a measured cost instead
 * of a hunch.
 *
 * COST WHEN OFF. `enabled` is false by default and every entry point early-
 * returns on it, so the instrumentation costs one boolean test per call site.
 * Nothing allocates, nothing is timed, no strings are built.
 *
 * USAGE (devtools console, on the dungeon screen):
 *   __dungeonProfile()        → profile ~240 frames, print a table, auto-stop
 *   __dungeonProfile(600)     → profile 600 frames instead
 *   __dungeonProfileStop()    → stop early and print what it has
 *
 * READING IT. `frame p50/p95` is the whole rAF callback. A p95 far above p50 is
 * the signature of a HITCH (occasional expensive frame) rather than a uniformly
 * slow game — hitches are what read as "jitter", and they usually come from
 * allocation, DOM writes or a rebuild, not from steady-state draw cost.
 *
 * The budget is 16.67ms for 60fps. A stage at 1ms is not your problem no matter
 * how ugly its code looks.
 *
 * TRUST. Every run prints the GPU it ran on. If that line says SOFTWARE
 * RASTERISER the numbers describe a CPU pretending to be a GPU and cannot be
 * compared with anything — see engine/gpu-adapter.ts.
 */
import { gpuAdapterLabel, isSoftwareAdapter, probeGpuAdapter } from "./gpu-adapter";

/** One accumulating timing bucket. */
interface Bucket {
  /** Every sample this run, kept so percentiles are exact rather than estimated. */
  samples: number[];
  /** Open sample start time; NaN when not inside a begin/end pair. */
  open: number;
}

const buckets = new Map<string, Bucket>();
let enabled = false;
let framesLeft = 0;
let frameCount = 0;
/** Wall-clock start, so we can report the real average FPS over the window. */
let runStart = 0;

function bucketFor(label: string): Bucket {
  let b = buckets.get(label);
  if (!b) {
    b = { samples: [], open: NaN };
    buckets.set(label, b);
  }
  return b;
}

/** Open a timing span. Cheap no-op while the profiler is off. */
export function profBegin(label: string): void {
  if (!enabled) return;
  bucketFor(label).open = performance.now();
}

/** Close the span opened by `profBegin(label)`. */
export function profEnd(label: string): void {
  if (!enabled) return;
  const b = buckets.get(label);
  if (!b || Number.isNaN(b.open)) return;
  b.samples.push(performance.now() - b.open);
  b.open = NaN;
}

/**
 * Record a raw count for this frame (draw calls, live particles, …). Counts are
 * summarised like timings but reported without the ms unit.
 */
export function profCount(label: string, n: number): void {
  if (!enabled) return;
  bucketFor(`# ${label}`).samples.push(n);
}

/** Call once per rendered frame; drives the auto-stop. */
export function profFrame(): void {
  if (!enabled) return;
  frameCount++;
  if (--framesLeft <= 0) stop();
}

export function isProfiling(): boolean {
  return enabled;
}

/** One summarised stage, as returned by {@link getProfileSummary}. */
export interface ProfileStage {
  stage: string;
  avg: number;
  p50: number;
  p95: number;
  max: number;
  n: number;
}

/**
 * The last completed run's stages, heaviest first — the machine-readable twin
 * of the console table. The headless runner needs this to enforce a frame
 * budget, so it must survive past `stop()`.
 */
let lastSummary: ProfileStage[] = [];

export function getProfileSummary(): ProfileStage[] {
  return lastSummary;
}

/** p95 of the whole-frame stage, or 0 if the profiler never ran. */
export function getP95FrameMs(): number {
  return lastSummary.find((s) => s.stage === "FRAME (total)")?.p95 ?? 0;
}

/** 60fps. The one number every frame stat below is judged against. */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * What a player actually feels, as opposed to what an average hides.
 *
 * A p95 alone cannot tell a uniformly slow game from a smooth one that hitches
 * twice a second, and those need opposite fixes — see this module's header.
 * `jankPct` is the share of frames that MISSED the 60fps budget and `worst` is
 * the single ugliest one; together with p99 they are the numbers to gate on.
 * Kept as raw whole-frame samples so the percentiles are exact.
 */
export interface FrameStats {
  n: number;
  fps: number;
  p50: number;
  p95: number;
  p99: number;
  worst: number;
  /** Share of frames over FRAME_BUDGET_MS, 0-100. */
  jankPct: number;
  /** Share over twice the budget — a visible stutter, not a missed vsync. */
  stutterPct: number;
}

let lastFrameStats: FrameStats | null = null;

/** Whole-frame stats from the last completed run, or null if none. */
export function getFrameStats(): FrameStats | null {
  return lastFrameStats;
}

function frameStatsFrom(samples: readonly number[], wallMs: number): FrameStats | null {
  if (!samples.length) return null;
  const sorted = [...samples].sort((x, y) => x - y);
  const over = (limit: number) => (sorted.filter((s) => s > limit).length / sorted.length) * 100;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    // Wall-clock fps, not 1000/p50 — the gaps BETWEEN frames are part of what
    // the player sees, and a frame that renders in 4ms but arrives every 33ms
    // is a 30fps experience however fast its callback was.
    fps: round(1000 / (wallMs / sorted.length)),
    p50: round(pct(sorted, 50)),
    p95: round(pct(sorted, 95)),
    p99: round(pct(sorted, 99)),
    worst: round(sorted[sorted.length - 1]),
    jankPct: round(over(FRAME_BUDGET_MS)),
    stutterPct: round(over(FRAME_BUDGET_MS * 2)),
  };
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function start(frames: number): void {
  buckets.clear();
  frameCount = 0;
  framesLeft = frames;
  runStart = performance.now();
  enabled = true;
  // Fire-and-forget: the probe is cached, so by the time `stop()` prints the
  // banner a run of any realistic length has long since resolved it. Starting
  // it here rather than at module load keeps the cost off the boot path.
  void probeGpuAdapter();
  // eslint-disable-next-line no-console
  console.log(`[profiler] running for ${frames} frames — play normally (bounce off walls to reproduce the jitter)`);
}

function stop(): void {
  if (!enabled) return;
  enabled = false;
  const wall = performance.now() - runStart;

  const rows: Array<Record<string, string | number>> = [];
  for (const [label, b] of buckets) {
    if (!b.samples.length) continue;
    const sorted = [...b.samples].sort((x, y) => x - y);
    const sum = sorted.reduce((a, c) => a + c, 0);
    const isCount = label.startsWith("# ");
    const round = (v: number) => (isCount ? Math.round(v) : Math.round(v * 100) / 100);
    rows.push({
      stage: label,
      // Share of a frame is meaningless for counts, so it is blank there.
      "avg": round(sum / sorted.length),
      "p50": round(pct(sorted, 50)),
      "p95": round(pct(sorted, 95)),
      "max": round(pct(sorted, 100)),
      "n": sorted.length,
    });
  }
  // Heaviest first — that is the only ordering anyone wants here.
  rows.sort((a, b) => Number(b["avg"]) - Number(a["avg"]));
  lastSummary = rows as unknown as ProfileStage[];
  lastFrameStats = frameStatsFrom(buckets.get("FRAME (total)")?.samples ?? [], wall);

  /* eslint-disable no-console */
  console.log(
    `[profiler] ${frameCount} frames in ${Math.round(wall)}ms — ` +
      `avg ${(1000 / (wall / Math.max(1, frameCount))).toFixed(1)} fps ` +
      `(budget: 16.67ms/frame for 60fps)`,
  );
  console.log(`[profiler] GPU: ${gpuAdapterLabel()}`);
  // The RESOLUTION, because a frame time without one is not comparable to any
  // other frame time — the same scene at 1080p is 2.25× the pixels of 720p.
  if (typeof window !== "undefined") {
    console.log(
      `[profiler] viewport: ${window.innerWidth}x${window.innerHeight} @ DPR ${window.devicePixelRatio ?? 1}`,
    );
  }
  console.table(rows);
  if (lastFrameStats) {
    const f = lastFrameStats;
    console.log(
      `[profiler] FRAME  p50 ${f.p50}ms  p95 ${f.p95}ms  p99 ${f.p99}ms  worst ${f.worst}ms  ` +
        `— ${f.jankPct}% of frames missed 60fps, ${f.stutterPct}% took over 33ms`,
    );
  }
  console.log("[profiler] p95 >> p50 on a stage means HITCHES in that stage, not steady cost.");
  // Loud, and last, so it is the line still on screen after the table scrolls.
  if (isSoftwareAdapter()) {
    console.warn(
      "[profiler] ⚠ UNTRUSTED RUN — this is a software rasteriser (or an adapter we could not identify).\n" +
        "GPU work reads as free and CPU work reads as catastrophic on one of these, so these numbers\n" +
        "must not be compared against a run from real silicon. Re-measure on a hardware adapter.",
    );
  }
  /* eslint-enable no-console */
}

/** Wire the console hooks. Safe to call more than once. */
export function installProfilerHooks(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, unknown>;
  w.__dungeonProfile = (frames = 240) => {
    start(frames);
    return `profiling ${frames} frames…`;
  };
  w.__dungeonProfileStop = () => {
    stop();
    return "stopped";
  };
  // Ask BEFORE profiling, not after: if this says software there is no point
  // spending 600 frames collecting numbers nobody may quote.
  w.__dungeonGpuInfo = async () => {
    const info = await probeGpuAdapter();
    if (!info) return "no WebGPU adapter (WebGL fallback, or navigator.gpu absent) — timings are UNTRUSTED";
    return `${gpuAdapterLabel()}${info.software ? "  — timings are UNTRUSTED" : "  — hardware, timings are comparable"}`;
  };
}
