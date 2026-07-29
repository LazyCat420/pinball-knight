/**
 * THE UI DRIVER — one call per frame, immediately before the pass composites.
 *
 * Ordering is the whole contract here. The layer's texture must be uploaded
 * BEFORE `pass.render()` runs, because that call does scene → target → final
 * composite in one go and samples the UI texture at the end of it. Painting
 * after would show the previous frame's UI: a menu that lags one frame behind
 * every keypress, which reads as input lag rather than as a frame-ordering bug.
 *
 * `boot/renderer.ts` guarantees the ordering by composing this into the pass's
 * own `render` rather than relying on a call site remembering to do it — see
 * the note there. `core.ts` is untouched: it still just calls
 * `state.pixelPass.render(scene, camera)`, and cannot get this wrong.
 */
import type { PixelPass } from "../engine/render/pixel-pass";
import { beginFrame, commit, fontsAreReady, markDirty, setUiActive, syncSize, uiSize } from "./layer";
import { beginUi, emptyUiInput, moveFocus, clampFocus, type UiFrame } from "./im";
import { setUiInputLive, takeFrame } from "./input";
import { pop, screens, top } from "./stack";

/**
 * True while the UI wants a repaint every frame.
 *
 * Most screens are static between inputs, but some animate (a flash message
 * fading, the tavern's fx, a card's holo sweep). Rather than have every screen
 * reason about dirtiness, the driver repaints whenever ANY screen is open. At
 * up to 1920x1080 that is a full-grid canvas clear + repaint per frame, which
 * sounds expensive and is not: the sim is paused behind every screen that
 * matters, so the frame budget is otherwise empty. Revisit only if the HUD
 * (which is open during play, in P3) shows up in the profiler.
 */
/**
 * How many times the driver has run, and how many of those painted.
 *
 * A canvas UI has two silent failure modes that look identical from the outside
 * (a blank screen): the driver never runs, or it runs and the composite eats
 * the result. `__gui().frames` tells them apart in one query instead of a
 * bisect — worth the two counters.
 */
export const uiStats = { frames: 0, painted: 0 };

export function drawUiFrame(pass: PixelPass): void {
  uiStats.frames++;
  const sizing = pass.sizing();
  syncSize(sizing);

  const list = screens();
  const open = list.length > 0;
  setUiInputLive(open);
  pass.setUiEnabled(open);

  if (!open) {
    if (setUiActiveIfChanged(false)) commit();
    return;
  }
  setUiActiveIfChanged(true);

  const g = beginFrame();
  if (!g) return;
  const { w, h } = uiSize();
  const input = takeFrame(sizing, window.innerWidth, window.innerHeight, performance.now());
  const active = top();

  for (const s of list) {
    // Only the TOP screen sees input. Everything below is painted for context
    // and must be inert — the stack's whole purpose is that "most modal first"
    // is a property of the data rather than a cascade of `if (el)` checks that
    // has to be maintained by hand (see input/keymap.ts's warning about order).
    const isTop = s === active;
    const f: UiFrame = beginUi(g, w, h, isTop ? input : emptyUiInput(), s.focus, fontsAreReady());
    s.paint(f, s);
    if (!isTop) continue;

    // Navigation resolves AFTER the paint, when `f.count` is the true number of
    // widgets this screen registered. Doing it before would use last frame's
    // count and wrap early on any screen whose row count changed.
    s.focus = clampFocus(f.focus, f.count);
    // The COUNT is the delta. Three quick Downs move three rows even if all
    // three landed between two painted frames.
    const delta = input.down - input.up;
    if (delta !== 0) s.focus = moveFocus(f, delta);

    if (input.cancel) {
      const handled = s.onCancel?.(s) ?? false;
      if (!handled) pop();
    }
  }

  uiStats.painted++;
  markDirty();
  commit();
}

/** setUiActive is idempotent, but the commit below should only run on a change. */
let lastActive = false;
function setUiActiveIfChanged(on: boolean): boolean {
  if (lastActive === on) return false;
  lastActive = on;
  setUiActive(on);
  return true;
}
