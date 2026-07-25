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
 */

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

  /* eslint-disable no-console */
  console.log(
    `[profiler] ${frameCount} frames in ${Math.round(wall)}ms — ` +
      `avg ${(1000 / (wall / Math.max(1, frameCount))).toFixed(1)} fps ` +
      `(budget: 16.67ms/frame for 60fps)`,
  );
  console.table(rows);
  console.log("[profiler] p95 >> p50 on a stage means HITCHES in that stage, not steady cost.");
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
}
