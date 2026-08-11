/**
 * CARD RENDER HARNESS — bundle the real card modules and run them in real Chrome.
 *
 * WHY THIS EXISTS. The card face is built from canvas-2D compositing passes
 * (`overlay`, `multiply`, `source-in`, gradients over near-black stock) whose
 * output differs between node-canvas and a browser — and several of the bugs
 * this harness caught were invisible in source review and untestable as data:
 * a rim light that rendered as red neon, a foil blend that erased an entire
 * card, a mote field that tiled into a screen-door mesh, a rib-cage sigil that
 * drew upside-down. The only way to know a card looks right is to render it in
 * the browser it ships to, and LOOK.
 *
 * Shared by scripts/card-sheet.mjs (faces), card-hover.mjs (pointer states),
 * card-sizes.mjs (74/124/186px) and glyph-sheet.mjs (the path library).
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { connectRealGpu } from "./host-chrome.mjs";

/** Read a `--flag value` argument, with a default. */
export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Bundle a TS entry point for the browser.
 *
 * esbuild is a devDependency, but it is only needed by these harnesses; if it
 * is missing, say so in one line rather than dumping a module-resolution stack.
 */
export async function bundle(contents) {
  let build;
  try {
    ({ build } = await import("esbuild"));
  } catch {
    console.error("This harness needs esbuild. Run: npm i");
    process.exit(1);
  }
  const out = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: "ts" },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2020",
  });
  return out.outputFiles[0].text;
}

/**
 * ── THE BUNDLED CHROMIUM CANNOT RASTERISE AT ALL ON THIS BOX ────────────────
 *
 * This used to launch Playwright's own Chromium under `--use-gl=swiftshader`,
 * on the reasoning that a 2D canvas needs no GPU. That reasoning is sound and
 * the browser is broken anyway. Measured 2026-08-11, WSL2, chrome-headless-shell:
 *
 *   evaluate 1+1          2         (4 ms)     ← the renderer is alive
 *   createElement canvas  {w:64}    (3 ms)
 *   getContext("2d")      {ok:true} (1 ms)
 *   ONE fillRect          TIMEOUT              ← and here it stops, forever
 *
 * ONE `fillRect` on a 64px canvas never returns. Not slow — hung: no crash, no
 * page error, no renderer CPU. It reproduces with `--use-gl=swiftshader`,
 * without any `--use-gl` flag, with `--disable-gpu`, with
 * `willReadFrequently: true`, and on `OffscreenCanvas`. Everything downstream
 * of the first raster op inherits it, which is why `bake-maze-textures.mjs`
 * looked like "one biome exceeds thirteen minutes of painting" for a week: the
 * painters were never the cost, and every one of the fourteen harnesses that
 * calls this function was dead the same way.
 *
 * The same loop the bake was blamed for — 262,144 `fillStyle` + `fillRect(1,1)`
 * on a 512×512 canvas, the floor painter's inner loop — runs on the HOST's
 * Chrome in **60 ms**, with `toDataURL` at 148 ms. So there is nothing to
 * optimise and nothing to transcribe into Rust (see docs/src/art/bake.md); the
 * bake just needs the browser pk-check and both A/B rigs already use.
 *
 * `PK_HARNESS_BROWSER=bundled` forces the old path — for a machine that HAS a
 * working bundled Chromium (CI, a native Linux box) and no host Chrome to
 * reach. `host` is the default and falls back on its own if no Windows Chrome
 * is found, so this file behaves correctly off WSL2 without being told.
 */
async function openBrowser({ width, height, scale }) {
  if (process.env.PK_HARNESS_BROWSER !== "bundled") {
    const browser = await connectRealGpu({ headed: false });
    if (browser) {
      // Over CDP the default context is the browser's own — `newContext()` is
      // a separate, weaker path here, and the default one is what the A/B rigs
      // drive. Viewport is set on the page instead of at context creation for
      // the same reason.
      const ctx = browser.contexts()[0] ?? (await browser.newContext());
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height });
      return { browser, page };
    }
    console.warn("[harness] no host Chrome — falling back to the bundled Chromium");
  }
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  return { browser, page };
}

/**
 * Open a page on the given HTML, wait for `window.__ready`, and hand it back.
 *
 * Runs on the HOST's Chrome by default — see `openBrowser` above for the
 * measurement that forced that, which is not the reason anyone would guess.
 *
 * `ready` names the flag this page raises when its work is done, and `timeout`
 * how long that may take. The contact-sheet harnesses paint on load and are
 * ready in under a second; a BAKE runs every surface in every biome before it
 * publishes anything, so it needs both a different flag and a longer leash.
 * Defaulting to `__ready`/20 s keeps all fourteen existing callers unchanged.
 */
export async function open(html, { width = 1400, height = 900, scale = 2, ready = "__ready", timeout = 20_000 } = {}) {
  const { browser, page } = await openBrowser({ width, height, scale });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("[page]", m.text());
  });
  // SERVED FROM A REAL ORIGIN, not `setContent`.
  //
  // `setContent` leaves the document on `about:blank`, which is an OPAQUE
  // origin: every `localStorage` access throws "Access is denied for this
  // document". The bundle reaches localStorage at module scope (settings load),
  // so the whole IIFE died before it could set `window.__marble` — and the only
  // symptom was `waitForFunction(__ready)` timing out 20 s later, which reads
  // like a slow render rather than a page that never ran. Every harness in this
  // file was dead this way, which is worth stating plainly: a broken tool looks
  // exactly like the art being unmeasurable.
  await page.route("http://harness.local/*", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto("http://harness.local/index.html");
  await page.waitForFunction((flag) => !!window[flag], ready, { timeout });
  await page.waitForTimeout(350);
  return { browser, page };
}

/** Write a screenshot buffer, creating the directory. */
export function save(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log("wrote", path);
}
