/**
 * `window.__gui` — driving the in-game UI from the console.
 *
 * The DOM overlays could be inspected with devtools: you could see the element
 * tree, read the computed styles, and click things by hand. A canvas UI has
 * none of that. Everything you might have reached for in the elements panel has
 * to be a hook here instead, or the UI becomes undebuggable the moment it
 * misbehaves.
 *
 *   __gui()            what is open, and the focus cursor
 *   __gui.settings()   push the settings screen
 *   __gui.close()      pop the top screen
 *   __gui.probe()      the ORIENTATION probe — see below
 *   __gui.face()       the mugshot's contact sheet: every tier × every mood
 *   __gui.shot()       the UI layer as a data URL, for headless diffing
 *
 * `probe()` is the one that matters most. This repo shipped a v-flip "fix"
 * TWICE by eyeballing symmetric content, and a centred menu sheet is exactly
 * the kind of content that looks correct upside down. The probe paints an
 * asymmetric marker (a block in the TOP-LEFT eighth plus a bar down the LEFT
 * edge) so orientation can be read off the screen instead of guessed at.
 */
import { faceContactSheet } from "../hud-face";
import { fontsAreReady, paintOrientationProbe, uiCtx } from "../gui/layer";
import { clearScreens, pop, push, screens, top } from "../gui/stack";
import { uiStats } from "../gui/root";
import { state } from "../state";
import { toggleDebugPanel } from "../debug-panel";
import { openFloorLoading } from "../gui/screens/floor-loading";
import { settingsScreen } from "../gui/screens/settings";
import { menuScreen } from "../gui/screens/menu";
import { tavernScreen } from "../gui/screens/tavern";
import { gameOverScreen } from "../gui/screens/game-over";
import { shopScreen } from "../gui/screens/shop";
import { characterSelectScreen } from "../gui/screens/character-select";

export function installGuiHooks(): void {
  if (typeof window === "undefined") return;

  const gui = (): unknown => ({
    open: screens().map((s) => s.id),
    top: top()?.id ?? null,
    focus: top()?.focus ?? -1,
    // The scroll offset of the top screen. A canvas list gives no scrollbar to
    // read in devtools, so "did the wheel reach the UI at all" is otherwise
    // indistinguishable from "the wheel reached it and the clamp ate it".
    scroll: top()?.scroll ?? 0,
    paused: screens().some((s) => s.pauses),
    frames: uiStats.frames,
    painted: uiStats.painted,
    fonts: fontsAreReady(),
  });

  const api = gui as unknown as Record<string, unknown>;
  /**
   * The pass's CURRENT grid, which is the UI's coordinate system.
   *
   * A harness that wants to click a widget has to convert window px → UI px,
   * and the only correct source for that conversion is the pass's own sizing
   * (see the warning on `PixelPass.sizing`). Exposing it here is what stops
   * every test script from recomputing `computeRenderSizing(window…)` and
   * drifting from the live value for a frame after each resize.
   */
  api.sizing = (): unknown => state.pixelPass?.sizing() ?? null;
  /** The ` console, without a keypress — for headless shots of the panel. */
  api.debug = (): unknown => {
    toggleDebugPanel();
    return gui();
  };
  /**
   * The descent screen, held open.
   *
   * It normally lives for the length of one floor build, which is far too
   * short to photograph. This pushes it and leaves it up; `__gui.close()`
   * dismisses it.
   */
  api.loading = (level = 3): unknown => {
    const h = openFloorLoading(level);
    h.phase("CARVING", 0.42);
    return gui();
  };
  api.settings = (): unknown => {
    push(settingsScreen());
    return gui();
  };
  /**
   * Re-open the character select at will.
   *
   * The lobby asks once per page load, which is right for a player and wrong
   * for anyone iterating on a sheet: `__lab.playAs` + reload was the old cost,
   * and answering it with "reload again" would put the cost back.
   */
  api.characters = (): unknown => {
    push(characterSelectScreen(() => {}));
    return gui();
  };
  api.menu = (tab?: string): unknown => {
    const m = menuScreen(() => {});
    push(m);
    // Tab is selected by simulating the digit the tab strip already listens
    // for, so the hook cannot drift from what a player's keypress does.
    if (tab) (window as unknown as { __guiTab?: string }).__guiTab = tab;
    return gui();
  };
  api.tavern = (vendor?: string): unknown => {
    push(
      tavernScreen({
        stats: { grade: "B", floor: 1, kills: 0, bestCombo: 0 },
        onDescend: () => {},
        ...(vendor ? { vendor: vendor as "cards" | "weapons" | "armor" | "potions", onClose: () => {} } : {}),
      }),
    );
    return gui();
  };
  api.dead = (): unknown => {
    push(gameOverScreen({ onTavern: () => {}, onRetry: () => {}, onExit: () => {}, droppedCount: 3 }));
    return gui();
  };
  api.shop = (): unknown => {
    push(
      shopScreen(
        [
          { id: "health", label: "Health Potion", icon: "", price: 15, detail: "restores 3 hearts" },
          { id: "rage", label: "Rage Potion", icon: "", price: 28, detail: "double damage" },
        ],
        () => 100,
        () => {},
        () => {},
      ),
    );
    return gui();
  };
  api.close = (): unknown => {
    pop();
    return gui();
  };
  api.clear = (): unknown => {
    clearScreens();
    return gui();
  };
  api.face = (): string => {
    // The mugshot's contact sheet, as a SCREEN for the same reason `probe()` is
    // one: a fire-and-forget paint is cleared before it is ever presented.
    const sheet = faceContactSheet();
    push({
      id: "face",
      pauses: true,
      focus: 0,
      scroll: 0,
      paint: (f) => {
        f.g.fillStyle = "#0b0d12";
        f.g.fillRect(0, 0, f.w, f.h);
        // Whole-number scale only — this is pixel art, and judging it through a
        // fractional resample is exactly the bug the sheet exists to catch.
        const s = Math.max(1, Math.floor(Math.min(f.w / sheet.width, f.h / sheet.height)));
        f.g.imageSmoothingEnabled = false;
        f.g.drawImage(
          sheet,
          Math.round((f.w - sheet.width * s) / 2),
          Math.round((f.h - sheet.height * s) / 2),
          sheet.width * s,
          sheet.height * s,
        );
      },
    });
    return "face sheet pushed — columns are moods, rows are health tiers (fresh → dead)";
  };
  api.probe = (): string => {
    // A SCREEN, not a one-shot paint. The driver clears and repaints the layer
    // every frame and disables the composite when the stack is empty, so a
    // fire-and-forget paint is erased before it is ever presented — which looks
    // exactly like "the composite does not work" and would have sent this
    // investigation somewhere very wrong.
    push({
      id: "probe",
      pauses: true,
      focus: 0,
      scroll: 0,
      paint: () => paintOrientationProbe(),
    });
    return "probe screen pushed — the gold block belongs TOP-LEFT, the cyan bar down the LEFT edge";
  };
  api.shot = (): string | null => {
    const ctx = uiCtx();
    return ctx ? ctx.canvas.toDataURL("image/png") : null;
  };

  (window as unknown as { __gui?: unknown }).__gui = gui;
}
