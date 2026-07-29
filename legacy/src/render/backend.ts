/**
 * Renderer backend selection — one place that decides WebGPU vs WebGL2.
 *
 * `WebGPURenderer` is not "the WebGPU renderer"; it is a renderer with two
 * backends. `forceWebGL: true` runs the exact same node-material code through a
 * WebGL2 backend, which is what makes an honest A/B possible: one build, one
 * code path, one flag. That is the whole reason this file exists rather than
 * each scene re-deriving the choice.
 *
 *   ?gpu=webgpu — force the WebGPU backend (fails loudly if unavailable)
 *   ?gpu=webgl  — force the WebGL2 backend (the everyday rollback)
 *   ?gpu=auto   — default: WEBGPU when the browser has it, else WebGL2
 *
 * Follows the `window.__debugFlags` precedent in src/main.ts.
 */

export type BackendChoice = "webgpu" | "webgl" | "auto";

export interface BackendSelection {
  /** Passed straight to `new WebGPURenderer({ forceWebGL })`. */
  forceWebGL: boolean;
  /** Resolved backend name, for logging and profiling labels. */
  name: "webgpu" | "webgl";
  /** What the URL actually asked for, before availability was considered. */
  requested: BackendChoice;
}

/**
 * True when the browser exposes a WebGPU adapter entry point at all.
 *
 * ⚠️ THIS IS NOT A WEBGPU AVAILABILITY CHECK, and treating it as one is how a
 * machine with a working GPU ends up rendering through WebGL2 without anyone
 * noticing. `navigator.gpu` can be PRESENT while `requestAdapter()` resolves to
 * NULL — Playwright's bundled Chromium on WSL2 does exactly that. The app then
 * asks for WebGPU, three.js is refused an adapter, prints one easily-missed
 * warning, and silently continues on WebGL2.
 *
 * Only `probeWebGPUAdapter()` answers the real question. This stays because the
 * synchronous answer is still the right gate for "should we even try", and
 * `selectBackend()` is called before an await is possible.
 */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && (navigator as any).gpu != null;
}

/**
 * Ask for a real adapter — the only trustworthy WebGPU check.
 *
 * Async, so it cannot gate `selectBackend()` (the renderer is constructed
 * synchronously). It exists so boot can VERIFY the choice after the fact and
 * say something loud when the entry point lied, rather than leaving a silent
 * downgrade to be discovered in a profile months later.
 */
export async function probeWebGPUAdapter(): Promise<{ ok: boolean; detail: string }> {
  if (!hasWebGPU()) return { ok: false, detail: "navigator.gpu absent" };
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) return { ok: false, detail: "requestAdapter() returned null — no usable adapter" };
    const info = adapter.info ? `${adapter.info.vendor}/${adapter.info.architecture}` : "adapter (no info)";
    return { ok: true, detail: info };
  } catch (err) {
    return { ok: false, detail: `requestAdapter() threw: ${String((err as Error)?.message ?? err).slice(0, 80)}` };
  }
}

function readRequested(): BackendChoice {
  if (typeof window === "undefined") return "auto";
  const raw = new URLSearchParams(window.location.search).get("gpu");
  if (raw === "webgpu" || raw === "webgl" || raw === "auto") return raw;
  return "auto";
}

/**
 * Resolve the backend for this page load. Cheap and side-effect free apart from
 * one log line, so it is fine to call once per renderer.
 *
 * Note `?gpu=webgpu` is deliberately NOT downgraded when WebGPU is missing: an
 * explicit force that silently ran the other backend would corrupt an A/B
 * measurement, which is the one thing this helper exists to protect.
 */
/**
 * Report which backend the renderer ACTUALLY resolved, after `init()`.
 *
 * Console + `window.__renderBackendResolved` only. This must never render
 * anything: it is a debugging aid for us, and the site's visitors should have
 * no idea it exists. `scripts/webgpu-check.mjs` reads the same globals.
 *
 * The distinction it exists to expose: `__renderBackend` is what we ASKED for,
 * this is what we GOT. They disagree exactly when the silent fallback fires,
 * which is the case nobody notices on their own.
 */
export async function reportResolvedBackend(renderer: unknown): Promise<void> {
  const backend = (renderer as { backend?: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean } })?.backend;
  const resolved: "webgpu" | "webgl" | "unknown" = backend?.isWebGPUBackend
    ? "webgpu"
    : backend?.isWebGLBackend
      ? "webgl"
      : "unknown";

  if (typeof window !== "undefined") {
    (window as any).__renderBackendResolved = resolved;
  }

  const requested = typeof window !== "undefined" ? (window as any).__renderBackend : undefined;

  if (resolved === "webgpu") {
    console.log(`[backend] ✔ resolved WEBGPU`);
    return;
  }

  // A downgrade is the whole reason this function exists — say so at a level
  // that survives a busy console, and say WHY, because "no adapter" and "we
  // asked for WebGL" are completely different problems.
  const probe = await probeWebGPUAdapter();
  console.error(
    `[backend] ✖ resolved ${resolved.toUpperCase()} (requested ${String(requested ?? "?").toUpperCase()}) — ` +
      `WebGPU probe: ${probe.detail}`,
  );
}

export function selectBackend(): BackendSelection {
  const requested = readRequested();
  const available = hasWebGPU();

  let forceWebGL: boolean;
  if (requested === "webgl") {
    forceWebGL = true;
  } else if (requested === "webgpu") {
    forceWebGL = false;
    if (!available) {
      console.warn("[backend] ?gpu=webgpu forced, but navigator.gpu is absent — init will likely fail.");
    }
  } else {
    // AUTO DEFAULTS TO WEBGPU when the browser exposes it, falling back to
    // WebGL2 otherwise. WebGPU is the intended renderer for this game; WebGL2 is
    // the backup.
    //
    // HISTORY — why this used to be pinned to WebGL2, and why that was wrong.
    // The previous default (cf377a9) forced WebGL2 because "the WebGPU backend
    // renders this game's render-target pipeline UPSIDE DOWN on some Chromium
    // forks". The upside-down render was real, but the attribution was not: the
    // flip is NOT backend-specific and NOT fork-specific. It was a set of
    // CanvasTextures on material `map`s left at three's default flipY=true —
    // the compensation the LEGACY WebGLRenderer wanted, which double-flips under
    // the node renderer on BOTH backends. Screenshot-verified tip-down on the
    // webgl backend AND on real Dawn, then upright on both once flipY was
    // cleared per texture (torch flame, wall/normal, banner, damage numbers,
    // peer nameplates, tavern sign).
    //
    // Forcing WebGL2 hid one symptom of that bug on one browser while leaving it
    // in every other. The textures are fixed now, so the default goes back to
    // the renderer this game is meant to run on.
    forceWebGL = !available;
  }

  const name: "webgpu" | "webgl" = forceWebGL ? "webgl" : "webgpu";

  if (typeof window !== "undefined") {
    (window as any).__renderBackend = name;
  }
  console.log(`[backend] ${name} (requested=${requested}, navigator.gpu=${available ? "yes" : "no"})`);

  return { forceWebGL, name, requested };
}
