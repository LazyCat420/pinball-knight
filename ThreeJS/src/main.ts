/**
 * Pinball Knight Standalone Entry Point
 */
import { selectBackend, webgpuUnsupportedReason } from "./render/backend";
import { ensurePixelFonts } from "./pixel/pixel-font";
import { launchDungeonGame } from "./game/pinball-knight";

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
  console.log("🗡️ Starting Pinball Knight...");
  launchDungeonGame(() => {
    console.log("🗡️ Dungeon game exited — restarting");
    setTimeout(() => launchDungeonGame(), 100);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initGame());
} else {
  void initGame();
}
