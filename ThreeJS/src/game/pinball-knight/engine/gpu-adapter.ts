/**
 * Which GPU is actually rendering — and whether any timing taken on it means
 * anything.
 *
 * WHY THIS EXISTS. A profile taken under a SOFTWARE adapter (SwiftShader,
 * lavapipe, llvmpipe) looks exactly like a profile taken on real silicon: same
 * table, same units, plausible numbers. It is not comparable to one. Software
 * rasterisation moves the cost into the CPU, so GPU-side work reads as free and
 * CPU-side work reads as catastrophic — the ordering of the profiler's own
 * table inverts. An earlier experiment in this repo was invalidated exactly
 * this way, which is why the guard is a module and not a comment.
 *
 * Chrome falls back to SwiftShader silently: no console warning, no visible
 * difference, `navigator.gpu` present and working. Headless runs (playwright
 * with --use-gl=swiftshader) do it by default. So the only reliable tell is to
 * ask the adapter, and the only safe default is to treat an adapter we could
 * not identify as untrusted.
 */

/** What `GPUAdapter.info` gives us, narrowed to the fields we read. */
export interface GpuAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  /** True when this is a CPU rasteriser pretending to be a GPU. */
  software: boolean;
}

/**
 * Substrings that identify a CPU rasteriser. Matched case-insensitively over
 * every field joined together, because which field carries the tell varies by
 * platform: Chrome/Linux puts "swiftshader" in `vendor`, Mesa puts "llvmpipe"
 * in `device`, and the WebGL fallback path puts "Basic Render" in the renderer
 * string.
 */
const SOFTWARE_MARKERS = ["swiftshader", "lavapipe", "llvmpipe", "software", "basic render", "microsoft basic"];

let probed: GpuAdapterInfo | null = null;
let probeStarted = false;

/**
 * Ask the browser what it is rendering on. Idempotent and cached — the adapter
 * cannot change mid-session, and requesting one repeatedly is wasteful.
 *
 * Resolves to null when WebGPU is absent entirely (the `?gpu=webgl` path, or a
 * browser without it). A null result is NOT "trusted": callers should treat
 * unknown the same as software, which {@link isSoftwareAdapter} does.
 */
export async function probeGpuAdapter(): Promise<GpuAdapterInfo | null> {
  if (probed) return probed;
  probeStarted = true;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return null;
  try {
    const adapter = (await gpu.requestAdapter()) as { info?: Partial<GpuAdapterInfo> } | null;
    if (!adapter) return null;
    // `adapter.info` is the current API; older Chrome exposed the same shape
    // behind the async requestAdapterInfo(). Missing fields read as "" rather
    // than undefined so the join below never stringifies "undefined" and trips
    // a marker by accident.
    const raw = adapter.info ?? {};
    const vendor = String(raw.vendor ?? "");
    const architecture = String(raw.architecture ?? "");
    const device = String(raw.device ?? "");
    const description = String(raw.description ?? "");
    const haystack = `${vendor} ${architecture} ${device} ${description}`.toLowerCase();
    probed = {
      vendor,
      architecture,
      device,
      description,
      software: SOFTWARE_MARKERS.some((m) => haystack.includes(m)),
    };
    return probed;
  } catch {
    // A refused adapter request is not worth breaking the game over; the
    // caller's unknown-is-untrusted default covers it.
    return null;
  }
}

/** The cached probe, or null if {@link probeGpuAdapter} has not resolved yet. */
export function gpuAdapterInfo(): GpuAdapterInfo | null {
  return probed;
}

/**
 * True when timings taken right now must NOT be compared against timings from
 * another machine — i.e. the adapter is a known CPU rasteriser, OR we never
 * managed to identify it. Unknown counts as untrusted on purpose: silently
 * publishing a SwiftShader number as if it were real is the failure this module
 * exists to prevent, and the cost of a false warning is one extra line of log.
 */
export function isSoftwareAdapter(): boolean {
  return probed ? probed.software : true;
}

/** A one-line human label for the profiler banner and the console hook. */
export function gpuAdapterLabel(): string {
  if (!probed) return probeStarted ? "unknown adapter (probe pending or unavailable)" : "not probed";
  const parts = [probed.vendor, probed.architecture, probed.device].filter(Boolean);
  const name = parts.length ? parts.join(" / ") : probed.description || "unnamed adapter";
  return probed.software ? `${name}  ← SOFTWARE RASTERISER` : name;
}
