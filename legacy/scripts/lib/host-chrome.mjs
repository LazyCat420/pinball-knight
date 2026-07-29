/**
 * Drive the HOST's real Chrome over CDP.
 *
 * WHY: WSL2 has no GPU-backed browser of its own, and Playwright's bundled
 * Chromium falls back to SwiftShader — a software rasteriser on which GPU work
 * reads as free and CPU work reads as catastrophic. Any run that quotes a
 * millisecond has to happen on real silicon, which means Windows Chrome,
 * launched from WSL and connected back through a loopback debugging port.
 *
 * Extracted from scripts/playtest.mjs so the profiling harnesses share one
 * copy of the connect/rewrite/teardown dance rather than three drifting ones.
 */
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Windows Chrome locations, as seen from WSL2. */
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

/** True when a CDP endpoint is already answering on the port. */
export async function cdpAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

let spawnedHostBrowser = null;

/**
 * Launch (or reuse) a real-GPU browser and connect over CDP. Returns null when
 * no host browser can be found, so a caller can fall back loudly rather than
 * silently measuring software rendering.
 */
export async function connectRealGpu({ port = 9333, headed = false, sound = false, log = console.log } = {}) {
  if (await cdpAlive(port)) {
    log(`▶ reusing existing CDP browser on :${port}`);
    return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 120_000 });
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) return null;

  log(`▶ launching host browser for real-GPU timings\n    ${exe}`);
  spawnedHostBrowser = spawn(
    exe,
    [
      headed ? "--new-window" : "--headless=new",
      ...(sound ? [] : ["--mute-audio"]),
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      // A dedicated profile dir keeps this from colliding with the user's
      // everyday Chrome session (which would refuse the debugging port).
      "--user-data-dir=C:\\Temp\\bdb-playtest",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  spawnedHostBrowser.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpAlive(port)) {
      return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 120_000 });
    }
  }
  return null;
}

export function closeHostBrowser() {
  if (!spawnedHostBrowser) return;
  try {
    // The detached Windows process is not ours to signal from WSL; ask Windows.
    execSync(
      `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"CommandLine LIKE '%bdb-playtest%'\\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
      { stdio: "ignore", timeout: 20_000 },
    );
  } catch {
    /* best effort — a stray headless browser is not worth failing the run */
  }
  spawnedHostBrowser = null;
}

/**
 * WSL2 + host browser: Windows forwards its own localhost into WSL, but it
 * cannot reach the WSL subnet IP (the default firewall drops it). Rewrite a
 * WSL-local address to `localhost`, which is the path Windows actually routes.
 */
export function rewriteForHostBrowser(url, log = console.log) {
  const u = new URL(url, "http://localhost");
  if (u.hostname !== "localhost" && /^(127\.|0\.0\.0\.0|10\.|100\.|172\.|192\.168\.)/.test(u.hostname)) {
    u.hostname = "localhost";
    log(`▶ rewrote host → localhost for the host browser (WSL2 port forwarding)`);
    return u.toString();
  }
  return url;
}
