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
 * Open a page on the given HTML, wait for `window.__ready`, and hand it back.
 *
 * SwiftShader rather than a real GPU: these harnesses paint 2D canvases, so
 * software rasterisation is both sufficient and reproducible. (It would NOT be
 * sufficient for anything measuring GPU timing — see the WebGPU notes.)
 */
export async function open(html, { width = 1400, height = 900, scale = 2 } = {}) {
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
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
  await page.waitForFunction(() => window.__ready, null, { timeout: 20000 });
  await page.waitForTimeout(350);
  return { browser, page };
}

/** Write a screenshot buffer, creating the directory. */
export function save(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log("wrote", path);
}
