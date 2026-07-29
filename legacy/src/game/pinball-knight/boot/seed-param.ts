/**
 * `?seed=<int>` — pin the run seed so a floor regenerates identically.
 *
 * This is what makes two screenshots, two profiles or two floor censuses
 * comparable: without it every run builds a different maze and any diff between
 * them is measuring noise. Used by the renderer-migration baselines and
 * `scripts/floor-census.mjs`; harmless in normal play.
 */

/**
 * The pinned seed, or null when absent or unparseable so the caller falls back
 * to random.
 */
export function readSeedParam(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("seed");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  // Match the random path's range: a non-negative 31-bit int.
  return Math.abs(n) % 0x7fffffff;
}
