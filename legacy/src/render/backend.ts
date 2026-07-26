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
 *   ?gpu=auto   — default: WebGPU when the browser has it, else WebGL2
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

/** True when the browser exposes a WebGPU adapter entry point at all. */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && (navigator as any).gpu != null;
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
    forceWebGL = !available;
  }

  const name: "webgpu" | "webgl" = forceWebGL ? "webgl" : "webgpu";

  if (typeof window !== "undefined") {
    (window as any).__renderBackend = name;
  }
  console.log(`[backend] ${name} (requested=${requested}, navigator.gpu=${available ? "yes" : "no"})`);

  return { forceWebGL, name, requested };
}
