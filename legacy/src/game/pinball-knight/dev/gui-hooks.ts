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
 *   __gui.shot()       the UI layer as a data URL, for headless diffing
 *
 * `probe()` is the one that matters most. This repo shipped a v-flip "fix"
 * TWICE by eyeballing symmetric content, and a centred menu sheet is exactly
 * the kind of content that looks correct upside down. The probe paints an
 * asymmetric marker (a block in the TOP-LEFT eighth plus a bar down the LEFT
 * edge) so orientation can be read off the screen instead of guessed at.
 */
import { paintOrientationProbe, uiCtx } from "../gui/layer";
import { clearScreens, pop, push, screens, top } from "../gui/stack";
import { settingsScreen } from "../gui/screens/settings";

export function installGuiHooks(): void {
  if (typeof window === "undefined") return;

  const gui = (): unknown => ({
    open: screens().map((s) => s.id),
    top: top()?.id ?? null,
    focus: top()?.focus ?? -1,
    paused: screens().some((s) => s.pauses),
  });

  const api = gui as unknown as Record<string, unknown>;
  api.settings = (): unknown => {
    push(settingsScreen());
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
  api.probe = (): string => {
    paintOrientationProbe();
    return "probe painted — the gold block belongs TOP-LEFT, the cyan bar down the LEFT edge";
  };
  api.shot = (): string | null => {
    const ctx = uiCtx();
    return ctx ? ctx.canvas.toDataURL("image/png") : null;
  };

  (window as unknown as { __gui?: unknown }).__gui = gui;
}
