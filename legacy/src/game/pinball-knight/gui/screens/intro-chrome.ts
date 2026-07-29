/**
 * THE INTRO'S CHROME — skip button, title banner, fade.
 *
 * The intro's two 2D canvases are its RENDERING SURFACE for the side-scroller
 * gag and stay as they are. What lived alongside them was ordinary interface —
 * a `<button>`, a `<div>` banner with an injected `@keyframes` blink, and a
 * CSS-transitioned black fade — and that is what moves here.
 *
 * The intro drives `pixelPass.render()` on its own RAF, and that call is
 * wrapped to paint the UI layer first, so this screen composites exactly like
 * every other one: the title snaps to the palette, and the "PRESS ANY KEY"
 * blink is a wall-clock modulo instead of a CSS animation the pass never saw.
 */
import { UI } from "../theme";
import { button, fillRect, rect, text } from "../im";
import type { UiScreen } from "../stack";

interface IntroChrome {
  /** Show the title + PRESS ANY KEY. */
  showTitle: boolean;
  /** 0..1 black wipe. */
  fade: number;
}

const chrome: IntroChrome = { showTitle: false, fade: 0 };

export function setIntroTitle(on: boolean): void {
  chrome.showTitle = on;
}

export function setIntroFade(t: number): void {
  chrome.fade = Math.max(0, Math.min(1, t));
}

export function introChromeScreen(onSkip: () => void): UiScreen {
  return {
    id: "intro-chrome",
    // Does NOT pause: the intro runs its own RAF and there is no sim to freeze.
    // It also must not capture the keyboard — "PRESS ANY KEY" is handled by the
    // intro's own listener, and swallowing keys here would make it a lie.
    pauses: false,
    focus: 0,
    scroll: 0,
    // See `UiScreen.design`. Four words and a button, so it takes the largest
    // zoom the grid allows — a title card is the one place in the game where
    // small type has nothing to trade itself against.
    design: { w: 480, h: 270 },
    paint(f) {
      if (chrome.showTitle) {
        text(f, "PINBALL KNIGHT", f.w / 2, f.h * 0.78, { size: 32, colour: UI.heading, align: "center" });
        // A 1.1s step blink, from wall clock. The CSS keyframes this replaces
        // needed a stylesheet injected into document.head for one animation.
        if (performance.now() % 1100 < 620) {
          text(f, "PRESS ANY KEY", f.w / 2, f.h * 0.78 + 46, { size: 8, colour: UI.text, align: "center" });
        }
      }

      // SKIP is the one interactive thing here, so it is the one focusable.
      if (button(f, rect(f.w - 116, f.h - 44, 100, 26), "SKIP")) onSkip();

      // The fade is painted LAST so it covers the title and the button, which
      // is what the DOM version's z-index ordering achieved.
      if (chrome.fade > 0) {
        f.g.globalAlpha = chrome.fade;
        fillRect(f, rect(0, 0, f.w, f.h), "#000000");
        f.g.globalAlpha = 1;
      }
    },
  };
}
