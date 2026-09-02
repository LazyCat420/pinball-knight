/**
 * Pinball Knight Standalone Entry Point
 */
import { selectBackend, webgpuUnsupportedReason } from "./render/backend";
import { ensurePixelFonts } from "./pixel/pixel-font";
import { launchDungeonGame } from "./game/pinball-knight";

/**
 * WHICH BUILD IS THIS? — stamped in by vite (see `define` in vite.config.ts).
 *
 * A player cannot tell a fixed build from a cached one, and neither could we:
 * three consecutive fixes for the monster death animation were reported as
 * "still broken" while the browser was serving an index.html — and therefore a
 * bundle — from before them. One line in the console, and one `__dungeonBuild()`
 * to read it back, settles that question in a second instead of a session.
 *
 * `nginx.conf` now forbids caching the HTML at all, which is the actual fix;
 * this is how anyone CHECKS it, here and on the deployed site.
 */
declare const __BUILD_ID__: string;
const BUILD_ID = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

async function initGame(): Promise<void> {
  const unsupported = webgpuUnsupportedReason();
  if (unsupported) {
    const notice = document.getElementById("fallback-notice");
    const reasonEl = document.getElementById("fallback-reason");
    if (notice && reasonEl) {
      reasonEl.textContent = unsupported;
      notice.style.display = "flex";
    }
    console.error("[pinball-knight] WebGPU unsupported:", unsupported);
    return;
  }

  // Select WebGPU backend
  selectBackend();

  // Pre-inject pixel fonts
  ensurePixelFonts();

  // Launch Pinball Knight Dungeon
  console.log(`🗡️ Starting Pinball Knight... [build ${BUILD_ID}]`);
  launchDungeonGame(() => {
    console.log("🗡️ Dungeon game exited — restarting");
    setTimeout(() => launchDungeonGame(), 100);
  });
}

// Readable from the console and from any harness: `__dungeonBuild()`.
(window as unknown as { __dungeonBuild?: () => string }).__dungeonBuild = () => BUILD_ID;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initGame());
} else {
  void initGame();
}
