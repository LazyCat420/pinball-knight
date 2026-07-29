/**
 * THE DESCENT SCREEN — shown while the next floor is built.
 *
 * ── THE ONE THING THIS SCREEN MUST NOT DO ──
 * Stall. It exists because building a floor blocks the GPU, and its entire job
 * is to be on screen DURING that block. That makes it the one place in this
 * migration where "the UI is painted from the render loop" is a hazard rather
 * than a convenience: if the loop is stalled, a painted screen freezes with it,
 * whereas the DOM version was composited by the browser and kept animating.
 *
 * So the bar is driven by WALL CLOCK, not by frames. When the loop stutters the
 * bar jumps to where it should be rather than pausing mid-sweep — a bar that
 * stops moving reads as a hang, which is exactly the impression this screen
 * exists to prevent. `descent bar stall is one compile` is a lesson this repo
 * has already paid for once.
 */
import { UI, GRID } from "../theme";
import { bar, fillRect, rect, text } from "../im";
import { close, push, type UiScreen } from "../stack";

/**
 * The SAME contract `floor-loading.ts` publishes, so the two are drop-in
 * interchangeable and the caller never learns which one it got.
 *
 * `phase()` NEVER goes backwards — the DOM version clamped that and it matters:
 * a bar that retreats mid-descent reads as the load having failed and restarted.
 */
export interface FloorLoading {
  phase(label: string, frac: number): void;
  close(): void;
}

interface LoadState {
  level: number;
  progress: number;
  label: string;
  startedAt: number;
}

let live: LoadState | null = null;

export function isFloorLoadingOpen(): boolean {
  return live !== null;
}

export function openFloorLoading(level: number): FloorLoading {
  live = { level, progress: 0, label: "DESCENDING", startedAt: performance.now() };
  push({
    id: "floor-loading",
    // Pauses, but nothing is running underneath anyway — the sim is between
    // floors. The flag matters so a stray key cannot act on the old floor.
    pauses: true,
    focus: 0,
    scroll: 0,
    // Not dismissable: closing it would reveal a half-built floor.
    onCancel: () => true,
    onClose: () => {
      live = null;
    },
    paint(f) {
      const s = live;
      if (!s) return;
      fillRect(f, rect(0, 0, f.w, f.h), UI.scrim);
      fillRect(f, rect(0, 0, f.w, f.h), UI.sheet);

      text(f, `FLOOR ${s.level}`, f.w / 2, f.h / 2 - 60, { size: 32, colour: UI.gold, align: "center" });
      text(f, s.label, f.w / 2, f.h / 2 - 14, { size: 8, colour: UI.textDim, align: "center" });

      const track = rect(f.w / 2 - 200, f.h / 2 + GRID, 400, 12);
      // MAX of reported progress and a slow wall-clock creep. If the build
      // blocks the loop, the reported value stops arriving; the creep keeps the
      // bar honest-looking without ever overtaking real progress by much.
      const creep = Math.min(0.9, (performance.now() - s.startedAt) / 4000);
      bar(f, track, Math.max(s.progress, creep), UI.gold);
    },
  });

  return {
    phase(label, frac) {
      if (!live) return;
      live.label = label;
      // Monotonic, like the DOM version: never let the bar retreat.
      live.progress = Math.max(live.progress, Math.max(0, Math.min(1, frac)));
    },
    close() {
      close("floor-loading");
    },
  };
}
