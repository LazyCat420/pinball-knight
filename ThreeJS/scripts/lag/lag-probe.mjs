/**
 * The in-page half of the lag profiler. Everything here is stringified and
 * injected before any app code runs (`page.addInitScript`), so it must be one
 * self-contained function with no imports and no closure over Node values.
 *
 * It records four things on a shared timebase (`performance.now()`):
 *
 *   frames     one entry per rAF, so hitches can be located to the millisecond
 *   gpu        every RARE WebGPU call that can block, with three's own label
 *   hot        per-frame totals for the calls that happen hundreds of times a
 *              frame, where a per-call record would cost more than it measures
 *   longtasks  PerformanceObserver('longtask') — >50ms tasks the browser saw
 *
 * plus `sync`, a uniquely-named burn loop used to align the V8 profiler's clock
 * with the page's (see alignByMarker in lag-profile.mjs).
 *
 * WHY WRAP THE GPU API FROM THE PAGE. The previous session reached for a
 * devtools extension to capture WebGPU commands; it was never needed. The API
 * is ordinary JS on `GPUDevice.prototype` / `GPUQueue.prototype`, three labels
 * its descriptors, and a prototype patch installed before the app loads sees
 * every call with its name attached.
 *
 * THE INSTRUMENT MUST NOT BE THE EXPENSE. `writeBuffer` and `setBindGroup`-class
 * calls run per object per frame; logging each one allocates faster than the
 * game does and would show up as its own hitch. Those are counted, not logged,
 * and the log itself is hard-capped.
 */
export function installLagProbe() {
  const w = window;
  if (w.__lag) return;
  /** Above this many logged calls, stop logging rather than blow out the heap. */
  const LOG_CAP = 120_000;
  const lag = {
    t0: performance.now(),
    frames: [],
    gpu: [],
    hot: [],
    longtasks: [],
    sync: [],
    held: [],
    capped: false,
  };
  w.__lag = lag;

  // ── Frame timeline ────────────────────────────────────────────────────────
  // An independent rAF chain. Callbacks registered by different code run in the
  // same frame batch, so these timestamps are the game's frame boundaries even
  // though the game drives its own loop.
  //
  // `held` marks the frames where the DESCENT SCREEN owns the display. The game
  // loop returns before rendering or simulating while a floor's pipelines warm
  // (sim/loop.ts), so those frames are long by design and the player is watching
  // a progress bar. Counted as hitches they OWN the tail — the worst frame in a
  // 30s run is reliably the warm-up doing its job — and every conclusion drawn
  // from a "worst frame" figure that included them was drawn about the loading
  // screen.
  let frame = 0;
  const hotFor = (i) => (lag.hot[i] ??= {});
  const tick = (t) => {
    frame = lag.frames.push(t) - 1;
    if (window.__dungeonHeld?.()) lag.held.push(frame);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ── Long tasks ────────────────────────────────────────────────────────────
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) lag.longtasks.push({ at: e.startTime, ms: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask is not observable everywhere; the frame timeline still stands */
  }

  // ── WebGPU call log ───────────────────────────────────────────────────────
  /** Rare + suspect: one record each, with the descriptor label. */
  const wrapLogged = (proto, name, describe) => {
    const orig = proto?.[name];
    if (typeof orig !== "function") return;
    proto[name] = function (...args) {
      const a = performance.now();
      const r = orig.apply(this, args);
      if (lag.gpu.length < LOG_CAP) {
        lag.gpu.push({ api: name, label: describe(args) || "", at: a, ms: performance.now() - a, f: frame });
      } else lag.capped = true;
      return r;
    };
  };
  /** Hot: per-frame {n, ms} only. No allocation per call. */
  const wrapCounted = (proto, name) => {
    const orig = proto?.[name];
    if (typeof orig !== "function") return;
    proto[name] = function (...args) {
      const a = performance.now();
      const r = orig.apply(this, args);
      const h = hotFor(frame);
      const c = (h[name] ??= { n: 0, ms: 0 });
      c.n++;
      c.ms += performance.now() - a;
      return r;
    };
  };

  const label = (args) => args[0]?.label;
  const dims = (d) => `${d?.width ?? d?.[0] ?? "?"}x${d?.height ?? d?.[1] ?? "?"}`;
  const install = () => {
    if (!w.GPUDevice) return false;
    const dev = w.GPUDevice.prototype;
    wrapLogged(dev, "createRenderPipeline", label);
    wrapLogged(dev, "createComputePipeline", label);
    wrapLogged(dev, "createShaderModule", label);
    wrapLogged(dev, "createTexture", (a) => `${a[0]?.label ?? ""} ${dims(a[0]?.size)}`);
    const q = w.GPUQueue?.prototype;
    wrapLogged(q, "writeTexture", (a) => `${a[0]?.texture?.label ?? ""} ${dims(a[3])}`);
    wrapLogged(q, "copyExternalImageToTexture", (a) => `${a[1]?.texture?.label ?? ""} ${dims(a[2])}`);
    wrapCounted(dev, "createBindGroup");
    wrapCounted(dev, "createBuffer");
    wrapCounted(q, "writeBuffer");
    wrapCounted(q, "submit");
    return true;
  };
  if (!install()) {
    const iv = setInterval(() => install() && clearInterval(iv), 5);
  }

  // ── Clock sync marker ─────────────────────────────────────────────────────
  // Burn CPU inside a function with a name nothing else in the bundle uses.
  // The V8 sampling profiler will show a dense block of samples under that
  // name; matching its midpoint against the page-time window recorded here
  // pins the two clocks together without assuming anything about the profiler's
  // epoch. Done at both ends of the run so drift is measurable, not assumed.
  w.__lagSync = (ms) => {
    const a = performance.now();
    (function __lagSyncMarker() {
      let x = 0;
      while (performance.now() - a < ms) x += Math.sqrt(x + 1);
      return x;
    })();
    const b = performance.now();
    lag.sync.push({ a, b });
    return { a, b };
  };

  /** Snapshot everything. Cleared by nothing — the caller may sample twice. */
  w.__lagDump = () => ({
    t0: lag.t0,
    now: performance.now(),
    frames: lag.frames,
    gpu: lag.gpu,
    hot: lag.hot,
    longtasks: lag.longtasks,
    sync: lag.sync,
    held: lag.held,
    capped: lag.capped,
  });
}
