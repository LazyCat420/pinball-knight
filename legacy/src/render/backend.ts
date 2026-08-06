/**
 * Renderer backend selection — one place that decides WebGPU vs WebGL2.
 *
 * `WebGPURenderer` is not "the WebGPU renderer"; it is a renderer with two
 * backends. This module used to own the choice between them; it now owns the
 * fact that there is no choice, plus the one question that replaced it —
 * whether the adapter we were handed is a real GPU.
 *
 * ── WEBGPU IS NOW THE ONLY BACKEND (2026-08-06) ───────────────────────────
 * There is no WebGL2 path any more, automatic or otherwise. The silent
 * downgrade this module was built to expose is gone because the thing it could
 * downgrade TO is gone: if WebGPU is unavailable the app says so, loudly, and
 * renders nothing rather than quietly running a second renderer nobody was
 * measuring.
 *
 * ⚠️ WHAT THIS COSTS, so nobody rediscovers it in a panic: WebGPU is a
 * SECURE-CONTEXT feature. `navigator.gpu` does not exist over plain http to an
 * IP, so `http://10.0.0.16:5174` now shows the unsupported message instead of
 * the game. `https://braindeadbot.com` has a real certificate and is
 * unaffected, and so is `localhost`. Develop on one of those two.
 *
 *   ?gpu=cpu — allow a SOFTWARE adapter through. Diagnostics only; see
 *              `probeWebGPUAdapter`. Never for measuring anything.
 *
 * Follows the `window.__debugFlags` precedent in src/main.ts.
 */

import { WebGPURenderer } from "three/webgpu";

/**
 * Build a renderer that CANNOT quietly become a WebGL renderer.
 *
 * ⚠️ THIS IS THE FUNCTION THAT MAKES "WEBGPU ONLY" TRUE. Dropping `forceWebGL`
 * is not sufficient and looked sufficient for an afternoon: `WebGPURenderer`
 * installs its OWN fallback in its constructor —
 *
 *     parameters.getFallback = () => { warn(...); return new WebGLBackend(...) }
 *
 * — unconditionally, clobbering anything passed in. `Renderer.init()` then
 * catches the "no adapter" error, calls that fallback, and RESOLVES
 * SUCCESSFULLY on WebGL2. Every downstream check that asks "did init work"
 * gets yes. The only visible trace is one `warn` in a busy console.
 *
 * Measured here on 2026-08-06, and it was not theoretical: with the GLSL twins
 * deleted, that silent fallback fed WGSL to `GLSLNodeBuilder` and the glass
 * threw on every material build.
 *
 * `_getFallback` is private, and reaching for it is the price of the guarantee.
 * `Renderer.init()` reads it exactly once (`if (this._getFallback !== null)`)
 * and rejects when it is null, which is the behaviour we want and the reason
 * this is a one-line reach rather than a fork.
 */
export function createGPURenderer(parameters: Record<string, unknown> = {}): WebGPURenderer {
  const renderer = new WebGPURenderer(parameters);
  (renderer as unknown as { _getFallback: unknown })._getFallback = null;
  return renderer;
}

export interface BackendSelection {
  /** Always "webgpu". Kept so logging and profiling labels stay stable. */
  name: "webgpu";
  /** True when the page allowed a software adapter via `?gpu=cpu`. */
  allowSoftware: boolean;
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
export async function probeWebGPUAdapter(
  allowSoftware = softwareAllowed(),
): Promise<{ ok: boolean; detail: string; software: boolean }> {
  if (!hasWebGPU()) {
    return { ok: false, detail: "navigator.gpu absent (needs https or localhost)", software: false };
  }
  try {
    // high-performance asks a laptop with two GPUs for the DISCRETE one rather
    // than the integrated part, and forceFallbackAdapter:false says outright
    // that a software rasteriser is not an acceptable substitute.
    const adapter = await (navigator as any).gpu.requestAdapter({
      powerPreference: "high-performance",
      forceFallbackAdapter: false,
    });
    if (!adapter) {
      return { ok: false, detail: "requestAdapter() returned null — no usable adapter", software: false };
    }

    const info = adapter.info ?? {};
    const label = [info.vendor, info.architecture, info.device, info.description]
      .filter(Boolean)
      .join("/") || "adapter (no info)";

    // ── IS THIS ACTUALLY A GPU? ──────────────────────────────────────────
    // Asking for a non-fallback adapter is a REQUEST, not a guarantee: a
    // browser with no usable hardware can still hand back a software
    // rasteriser. `isFallbackAdapter` is the spec's own answer and moved from
    // the adapter onto its info, so both spellings are checked; the name match
    // catches the ones that answer neither, which is how SwiftShader and
    // lavapipe usually arrive.
    const flagged = adapter.isFallbackAdapter === true || info.isFallbackAdapter === true;
    const named = /swiftshader|lavapipe|llvmpipe|software|microsoft basic/i.test(label);
    const software = flagged || named;

    if (software && !allowSoftware) {
      return {
        ok: false,
        software: true,
        detail: `software adapter refused (${label}) — this is a CPU rasteriser, not a GPU`,
      };
    }
    return { ok: true, detail: software ? `${label} [SOFTWARE]` : label, software };
  } catch (err) {
    return {
      ok: false,
      software: false,
      detail: `requestAdapter() threw: ${String((err as Error)?.message ?? err).slice(0, 80)}`,
    };
  }
}

/** `?gpu=cpu` — let a software adapter through. Diagnostics only. */
function softwareAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("gpu") === "cpu";
}

/**
 * Report what the renderer actually got, after `init()`.
 *
 * Console + `window.__renderBackendResolved` only. This must never render
 * anything: it is a debugging aid for us, and the site's visitors should have
 * no idea it exists. `scripts/webgpu-check.mjs` reads the same globals.
 *
 * With the WebGL backend gone this can no longer catch a silent DOWNGRADE —
 * there is nothing left to downgrade to. What it catches now is the other lie:
 * a backend that came up on a SOFTWARE adapter, which reports itself as WebGPU
 * in every way except the one that matters, and turns any timing measurement
 * into fiction.
 */
export async function reportResolvedBackend(renderer: unknown): Promise<void> {
  const backend = (renderer as { backend?: { isWebGPUBackend?: boolean } })?.backend;
  const resolved: "webgpu" | "unknown" = backend?.isWebGPUBackend ? "webgpu" : "unknown";

  if (typeof window !== "undefined") {
    (window as any).__renderBackendResolved = resolved;
  }

  if (resolved !== "webgpu") {
    console.error("[backend] \u2716 renderer did not come up on the WebGPU backend");
    return;
  }

  // Confirm it is a real GPU, not a CPU rasteriser wearing the same name.
  const probe = await probeWebGPUAdapter(true);
  if (typeof window !== "undefined") {
    (window as any).__renderAdapter = probe.detail;
    (window as any).__renderSoftware = probe.software;
  }
  if (probe.software) {
    console.error(
      `[backend] \u26a0 WEBGPU ON A SOFTWARE ADAPTER \u2014 ${probe.detail}. ` +
        "This is a CPU rasteriser: it renders correctly and measures nothing.",
    );
  } else {
    console.log(`[backend] \u2714 WEBGPU on ${probe.detail}`);
  }
}

/**
 * Resolve the backend for this page load.
 *
 * There is only one answer now. It stays a function because main.ts calls it,
 * because `allowSoftware` still has to be read from the URL, and because it is
 * the one place that publishes `__renderBackend`.
 */
export function selectBackend(): BackendSelection {
  const allowSoftware = softwareAllowed();
  if (typeof window !== "undefined") {
    (window as any).__renderBackend = "webgpu";
  }
  console.log(`[backend] webgpu (navigator.gpu=${hasWebGPU() ? "yes" : "no"})`);
  return { name: "webgpu", allowSoftware };
}

/**
 * Why this browser cannot run the game, as a sentence for a human — or null if
 * it can.
 *
 * Deliberately checks the SYNCHRONOUS condition only. The adapter probe is
 * async and the renderer is built synchronously, so the loud, specific failure
 * for "there is no adapter" belongs to the init() rejection path in main.ts.
 * This one catches the far more common case of a browser that never had WebGPU
 * at all — including, and this is the one that will bite during development,
 * any visitor on plain http to an IP address, because WebGPU is secure-context
 * only and `navigator.gpu` simply does not exist there.
 */
export function webgpuUnsupportedReason(): string | null {
  if (typeof window === "undefined") return null;
  if (hasWebGPU()) return null;
  return window.isSecureContext
    ? "This browser does not support WebGPU. Chrome, Edge or another Chromium-based browser will run it."
    : "WebGPU needs a secure context. Open this over https, or on localhost \u2014 an http:// address to a bare IP cannot run it.";
}
