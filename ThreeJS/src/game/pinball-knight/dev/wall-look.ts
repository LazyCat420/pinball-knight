/**
 * WHICH WALL LOOK THIS SESSION BUILDS — a dev flag with a loud mouth.
 *
 * Two candidate treatments exist for the same walls (maze/wall-runs.ts):
 *
 *   legacy  every wall tile is a bordered square with a carved panel, and every
 *           ~4th tall tile grows moss. What ships today, and the reason a long
 *           wall reads as a row of separate objects.
 *   runs    the wall MASS is outlined instead of tiled: a border where the
 *           stone ends, no panel inside a run, moss per run.
 *   tiles   the shipped square kept, but everything else run-aware.
 *
 * The flag exists because the choice is the user's and it has to be seen side
 * by side to be made. It is NOT a setting to ship: once a look is picked, this
 * file and the switch in maze/build.ts go away and the winner becomes the only
 * code path. A permanent flag would mean two wall renderers to keep alive, and
 * co-op peers on different looks would disagree about nothing visible today but
 * about `grid.shapes` the moment the shape vetoes land — which the collider
 * reads.
 *
 * Precedence copies dev/floor-lock.ts and boot/seed-param.ts, for the same
 * reason: one funnel, one answer to "what am I looking at".
 *   1. `?walls=runs|tiles|legacy` — explicit, wins, used by the screenshot
 *      harness so a captured frame cannot be mislabelled by stale storage.
 *   2. localStorage — the standing choice while playing (`__lab.walls("runs")`).
 *   3. legacy.
 */
import type { WallLook } from "../maze/wall-runs";

const KEY = "pinball-knight-dev-wall-look";

const LOOKS: readonly WallLook[] = ["legacy", "runs", "tiles"];

function parse(raw: string | null): WallLook | null {
  if (raw === null) return null;
  const v = raw.trim().toLowerCase();
  return (LOOKS as readonly string[]).includes(v) ? (v as WallLook) : null;
}

/** Memoised: the maze build path should not read localStorage per floor. */
let cached: WallLook | undefined;

export function wallLook(): WallLook {
  if (cached !== undefined) return cached;
  let look: WallLook | null = null;
  try {
    if (typeof window !== "undefined") look = parse(new URLSearchParams(window.location.search).get("walls"));
  } catch {
    look = null;
  }
  if (look === null) {
    try {
      look = parse(localStorage.getItem(KEY));
    } catch {
      look = null; // private mode — play the shipped look
    }
  }
  cached = look ?? "legacy";
  // Say so. A screenshot taken under a dev look and filed as the shipped one is
  // worse than no screenshot: it is evidence pointing the wrong way. Announced
  // from here rather than from the caller because `core.ts` is under a line
  // ratchet (core-boundary.test.ts) and a temporary flag has no business
  // spending it.
  if (cached !== "legacy") {
    console.warn(`[wall-look] walls are built with the "${cached}" look — __lab.walls("legacy") to go back`);
  }
  return cached;
}

export function setWallLook(look: WallLook): WallLook {
  cached = look;
  try {
    if (look === "legacy") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, look);
  } catch {
    // session-only this time; not fatal
  }
  return cached;
}

/** Test seam — drops the memo so a fresh URL/localStorage is re-read. */
export function __resetWallLookCache(): void {
  cached = undefined;
}
