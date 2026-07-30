#!/usr/bin/env node
/**
 * BIOME A/B — the same seeded floor, before and after, on a real WebGPU adapter.
 *
 * Recipe copied from scripts/gui-shot.mjs rather than re-derived: same CDP
 * launch, same "enter the maze properly" gate, same backend refusal. A
 * re-implemented harness is how you measure a pipeline the game does not run.
 *
 *   node biome-ab.mjs --before 5199 --after 5312 --out /tmp/shots
 *   node biome-ab.mjs --census /tmp/shots        # measure pairs already taken
 *
 * `?seed=` pins the maze AND the biome (themeIndexFor), so the two ports build
 * the same floor. An unseeded run rolls a different biome and the comparison is
 * garbage.
 *
 * `--census` is the half you actually judge with. "It looks better" is not a
 * result on a 32-colour palette; the family shares are. It reads the saved
 * pairs, so you can re-measure without re-shooting.
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

/**
 * Share of each palette FAMILY among the frame's on-palette pixels.
 *
 * Two things this deliberately does NOT do, both learned the hard way:
 *
 * - It does not count ink (1) and void (0) as "stone". They are the shared
 *   terminator every family falls through to, so folding them into stone hides
 *   the exact effect a shading change has.
 * - It does not report a share of ALL pixels. Roughly half the frame is
 *   off-palette BY DESIGN — the scanline pass dims every other row by 0.86 —
 *   so a denominator of "every pixel" buries every real move under a constant.
 */
const PALETTE_HEX = [
  0x0b0d12, 0x171a22, 0x2b303b, 0x454f5e, 0x6b7688, 0x9aa4b4,
  0x1e2f1f, 0x3d5c3a, 0x5f8a4f, 0x8fc46b,
  0x3a0f18, 0x6b1f2a, 0xa83244, 0xd95763,
  0x7a3b12, 0xd97b29, 0xf0a63c, 0xffd98a, 0xfff3c8,
  0x544e63, 0x8a94a6, 0xc8ccd4, 0xeef1f5,
  0x6b4436, 0xa9705a, 0xd69f7e,
  0x2a1c14, 0x4a3222, 0x6b4a2e,
  0x1f3d52, 0x2e6d8f, 0x6fd0e8,
];
const FAMILIES = {
  "void/ink": [0, 1], stone: [2, 3, 4, 5], rot: [6, 7, 8, 9], blood: [10, 11, 12, 13],
  torch: [14, 15, 16, 17, 18], steel: [19, 20, 21, 22], skin: [23, 24, 25],
  leather: [26, 27, 28], arcane: [29, 30, 31],
};

async function familyShares(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const index = new Map(PALETTE_HEX.map((h, i) => [h, i]));
  const hist = new Array(PALETTE_HEX.length).fill(0);
  let onPalette = 0;
  for (let p = 0; p < info.width * info.height; p++) {
    const i = index.get((data[p * ch] << 16) | (data[p * ch + 1] << 8) | data[p * ch + 2]);
    if (i === undefined) continue;
    hist[i]++; onPalette++;
  }
  const out = {};
  for (const [name, idxs] of Object.entries(FAMILIES)) {
    out[name] = onPalette ? (100 * idxs.reduce((s, i) => s + hist[i], 0)) / onPalette : 0;
  }
  return { shares: out, onPalette };
}

/** Print before → after family shares for every pair found in `dir`. */
async function censusDir(dir) {
  const names = Object.keys(FAMILIES);
  console.log("share of ON-PALETTE pixels (%), before → after   [* moved >1pp]\n");
  console.log("scene".padEnd(12) + names.map((k) => k.slice(0, 8).padStart(9)).join(""));
  for (const scene of SCENES) {
    const b = `${dir}/${scene.label}-before.png`, aft = `${dir}/${scene.label}-after.png`;
    if (!existsSync(b) || !existsSync(aft)) continue;
    const B = await familyShares(b), A = await familyShares(aft);
    console.log(scene.label.padEnd(12) + names.map((k) => B.shares[k].toFixed(1).padStart(9)).join(""));
    console.log("".padEnd(12) + names.map((k) => {
      const moved = Math.abs(A.shares[k] - B.shares[k]) >= 1;
      return (A.shares[k].toFixed(1) + (moved ? "*" : "")).padStart(9);
    }).join("") + `   ${scene.note}`);
    console.log("");
  }
}

const { values: a } = parseArgs({
  options: {
    census: { type: "string" },
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
  // ⚠️ The Cold Crypt is the control for the SHADE TABLE ONLY. Its masonry is
  // stone (entries 2/3/4) and stone is contiguous+descending, so `i-1` and
  // SHADE_DOWN agree on it — which is precisely why an all-stone biome hid the
  // 2026-07-30 bug. It is NOT a control for the frame: measured, its leather
  // went 37.2% → 6.7% at that fix, because everything else in shot (props,
  // track, warm-lit stone) could finally reach ink. Expect it to move.
  { label: "coldcrypt", seed: 6, mode: "maze", note: "biome 0 — stone masonry; control for the TABLE, not the frame" },
  { label: "warren", seed: 1, mode: "maze", note: "biome 1 — rot; greyed out under the i-1 fallback" },
  { label: "bloodworks", seed: 2, mode: "maze", note: "biome 2 — blood; never darkened at all under i-1" },
  { label: "arcanedeep", seed: 3, mode: "maze", note: "biome 3 — arcane; shaded warm brown under i-1" },
  { label: "seed777", seed: 777, mode: "maze", note: "depth 1 is the WARREN here, not the Crypt — the seed that misled" },
  { label: "tavern", seed: 6, mode: "hub", note: "leather floor + warm props" },
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

// Measure-only: no browser, no server, no seeds. Judge shots you already have.
if (a.census) {
  await censusDir(a.census);
  process.exit(0);
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
