#!/usr/bin/env node
/**
 * BIOME A/B — the same seeded floor, before and after, on a real WebGPU adapter.
 *
 * Recipe copied from scripts/gui-shot.mjs rather than re-derived: same CDP
 * launch, same "enter the maze properly" gate, same backend refusal. A
 * re-implemented harness is how you measure a pipeline the game does not run.
 *
 *   node biome-ab.mjs --before 5199 --after 5312 --out /tmp/shots
 *
 * `?seed=` pins the maze AND the biome (themeIndexFor), so the two ports build
 * the same floor. An unseeded run rolls a different biome and the comparison is
 * garbage.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";

/**
 * Fraction of the bottom 12% of a shot that is lit.
 *
 * The HUD only paints once the floor is PRESENTED. During the descent that
 * band is void — which is the one cheap signal that separates a real floor
 * from the loading card, since the card is drawn inside the canvas and no DOM
 * query can see it.
 */
async function hudLit(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const y0 = Math.floor(info.height * 0.88);
  let lit = 0, n = 0;
  for (let y = y0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const p = (y * info.width + x) * ch;
      if (data[p] + data[p + 1] + data[p + 2] > 90) lit++;
      n++;
    }
  }
  return lit / n;
}

const { values: a } = parseArgs({
  options: {
    before: { type: "string", default: "5199" },
    after: { type: "string", default: "5312" },
    "cdp-port": { type: "string", default: "9347" },
    out: { type: "string", default: "/tmp/shots" },
    boot: { type: "string", default: "9" },
    only: { type: "string" }, // comma list of labels to run
  },
});

// depth-1 biome for each seed, via themeIndexFor(1, seed) — computed offline.
const SCENES = [
  { label: "coldcrypt", seed: 6, mode: "maze", note: "biome 0 — NEGATIVE CONTROL, must not change" },
  { label: "warren", seed: 1, mode: "maze", note: "biome 1 — rot masonry greyed out before" },
  { label: "bloodworks", seed: 2, mode: "maze", note: "biome 2 — never darkened before" },
  { label: "arcanedeep", seed: 3, mode: "maze", note: "biome 3 — shaded warm brown before" },
  { label: "seed777", seed: 777, mode: "maze", note: "the original verification seed (Warren)" },
  { label: "tavern", seed: 6, mode: "hub", note: "leather floor — should now reach ink" },
];

const PORT = Number(a["cdp-port"]);
const WIN_CHROME = [
  "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
  "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureBrowser() {
  if (await cdpAlive()) {
    console.log(`▶ reusing CDP browser on :${PORT}`);
    return;
  }
  const exe = WIN_CHROME.find((p) => existsSync(p));
  if (!exe) throw new Error("no host Chrome — WSL2 headless has no WebGPU adapter");
  const proc = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    // Its OWN profile dir: must not touch the user's running Chrome.
    "--user-data-dir=C:\\Temp\\bdb-biome-ab",
    "--enable-unsafe-webgpu",
    "--window-size=1600,900",
  ], { detached: true, stdio: "ignore" });
  proc.unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpAlive()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("host Chrome did not expose CDP");
}

mkdirSync(a.out, { recursive: true });
await ensureBrowser();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());

const wanted = a.only ? new Set(a.only.split(",").map((s) => s.trim())) : null;
const results = [];

for (const scene of SCENES) {
  if (wanted && !wanted.has(scene.label)) continue;
  for (const [variant, port] of [["before", a.before], ["after", a.after]]) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.bringToFront();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const url = `http://localhost:${port}/dungeon?no-intro=1&gpu=webgpu&seed=${scene.seed}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => typeof window.__dungeonPlayer === "function", null, { timeout: 120_000 });
      if (scene.mode === "maze") {
        if (!(await page.evaluate(() => window.__dungeonPlayer()?.active === true))) {
          await page.evaluate(() => window.__dungeonStartRun?.());
        }
        await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 120_000 });
      }
      await page.waitForTimeout(Number(a.boot) * 1000);

      const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
      if (backend !== "webgpu") {
        console.error(`✘ ${scene.label}/${variant}: backend ${backend}, not webgpu — refusing to judge`);
        results.push({ ...scene, variant, backend, ok: false });
        await page.close();
        continue;
      }
      const adapter = await page.evaluate(async () => {
        try {
          const ad = await navigator.gpu.requestAdapter();
          return ad?.info ? `${ad.info.vendor ?? "?"}/${ad.info.architecture ?? "?"}` : "no-info";
        } catch { return "no-adapter"; }
      });
      const path = `${a.out}/${scene.label}-${variant}.png`;
      await page.screenshot({ path });

      // ── VACUITY GUARD ────────────────────────────────────────────────────
      //
      // `__dungeonPlayer().active` goes true while the DESCENT CARD is still
      // up: the card is drawn INSIDE the canvas by the GUI layer, so no DOM
      // query can see it, and the loop is HELD during floor generation. A
      // first, cold-compile load reliably lands here. Screenshotting then
      // yields a lovely picture of a loading screen, and a palette census of
      // it is pure noise that looks like data — this harness produced exactly
      // that on its first run.
      //
      // The HUD is the tell: it only paints once the floor is presented, and
      // it lives in the bottom band. During the descent that band is void.
      // Measured on the SAVED PNG, not through the page: the document has
      // several canvases (`#room-canvas-element` is the arcade room behind the
      // overlay and comes first in the DOM), and reading back a WebGPU canvas
      // in-page is its own trap. The screenshot is the artefact under
      // judgement, so judge the artefact.
      // The hub has no DEPTH/KILLS HUD, so the guard does not apply there —
      // and the hub never shows a descent card either, which is why it is safe
      // to skip rather than to weaken the test for everyone.
      const hud = scene.mode === "hub" ? 1 : await hudLit(path);
      if (!(hud > 0.03)) {
        console.error(`✘ ${scene.label}/${variant}: HUD band ${(hud * 100).toFixed(1)}% lit — still on the descent card, NOT a floor. Raise --boot.`);
        results.push({ ...scene, variant, ok: false, reason: "descent-card", hud });
        await page.close();
        continue;
      }
      console.log(`✔ ${scene.label.padEnd(11)} ${variant.padEnd(6)} adapter=${adapter} hud=${(hud * 100).toFixed(1)}%  ${path}`);
      results.push({ ...scene, variant, backend, adapter, path, hud, ok: true, errs: errs.slice(0, 2) });
    } catch (e) {
      console.error(`✘ ${scene.label}/${variant}: ${e.message}`);
      results.push({ ...scene, variant, ok: false, error: e.message });
    }
    await page.close();
  }
}

await browser.close();
console.log("\n" + JSON.stringify(results.map((r) => ({ label: r.label, variant: r.variant, ok: r.ok, adapter: r.adapter })), null, 1));
