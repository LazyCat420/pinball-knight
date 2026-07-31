#!/usr/bin/env node
/**
 * SPRITE SANDBOX — see what a change looks like BEFORE anyone boots the game.
 *
 * Two modes, because "does the art hold up" is two different questions:
 *
 * ── CEL MODE (default) — the strategy shoot-out, offline ─────────────────────
 *
 *   node scripts/sandbox.mjs
 *   node scripts/sandbox.mjs --grid 72 --zoom 4 --out scratchpad/sandbox/cel.png
 *
 * Renders every import filter side by side against the hand-written painter,
 * through the REAL pipeline (`importedPaints` → `paintInArtSpace` →
 * `crushToGrid` — nothing re-implemented), nearest-upscaled so the atlas texels
 * are the thing on screen. Arms:
 *
 *   painted    the procedural painter (the bar to clear)
 *   bilinear   one smoothed drawImage — what the import path DID before the
 *              2026-07-31 fix; kept as the regression reference
 *   nearest    point sampling — what LibreSprite / Pixelorama batch "resize +
 *              index colors" would feed the crush. The editors are fine tools
 *              for HAND-pixelling (that is the workflow they exist for); their
 *              scalers assume art that is already on a grid, which generated
 *              sheets are not. This arm is that pipeline given a fair run.
 *   box        premultiplied area average (the crush's own filter, applied at
 *              the cell hop)
 *   dominant   box unless one colour owns ≥50% of a texel — the "hybrid"
 *              strategy from the AI-art-fixing tools
 *   kcentroid  per-texel 2-means dominant centroid (Astropulse's pixeldetector
 *              lineage) — what the game ships
 *
 * Each arm prints its census (isolated% / runLen) in the strip, so the picture
 * and the numbers travel together. Numbers CANNOT crown the winner alone: the
 * census was calibrated on painter-scale sprites, and a bigger, crisper import
 * carries more deliberate single-texel detail that "isolated%" counts as
 * noise. Look at the strip.
 *
 * ── GAME MODE — the same creatures on a live floor, real WebGPU ──────────────
 *
 *   node scripts/sandbox.mjs --mode game --spawn jester,rotortail
 *   node scripts/sandbox.mjs --mode game --spawn jester --n 8 --imported 0
 *
 * Drives the HOST's Chrome over CDP (same recipe as gui-shot.mjs — WSL2's
 * bundled Chromium has no WebGPU adapter), boots a run, spawns the requested
 * kinds via the monster lab (`__lab.only` bypasses level gates; never restart
 * a run to test a monster), and screenshots the floor. `--imported 0` flips
 * the localStorage toggle BEFORE boot so the painter build of the same
 * creature is one flag away.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { arg, bundle, open, save } from "./lib/card-harness.mjs";

const mode = arg("mode", "cel");

// ═══════════════════════════════════════════════════════════════════ CEL MODE
async function celMode() {
  const grid = Number(arg("grid", "63")); // SHIPPED_GRID — the default camera rung
  const zoom = Number(arg("zoom", "3"));
  const out = arg("out", `scratchpad/sandbox/cel-${grid}.png`);

  /** Subject → the sheet that reskins it. Mirrors IMPORTED_ART in boot/sheets.ts. */
  const SUBJECTS = [
    { key: "jester", sheet: "jester" },
    { key: "rotortail", sheet: "beaver" },
  ];

  // The sheets travel as data URLs — the page is served from a string, so
  // there is no origin to fetch /sprites from.
  const sheets = {};
  for (const s of SUBJECTS) {
    const manifest = JSON.parse(readFileSync(join("public", "sprites", `${s.sheet}-S.json`), "utf8"));
    const png = readFileSync(join("public", "sprites", `${s.sheet}-S.png`));
    sheets[s.key] = { manifest, dataUrl: `data:image/png;base64,${png.toString("base64")}` };
  }

  const js = await bundle(`
import { paintInArtSpace, crushToGrid } from "./src/game/pinball-knight/engine/render/sprite";
import { setEnginePalette } from "./src/game/pinball-knight/engine/palette-source";
import { PALETTE_HEX, PALETTE_SIZE, paletteCss, paletteToFloatArray } from "./src/game/pinball-knight/render/palette";
import { censusCell, paletteRgb } from "./src/game/pinball-knight/render/atlas-census";
import { importedPaints } from "./src/game/pinball-knight/render/imported-paints";
import { makeJesterPaints } from "./src/game/pinball-knight/render/monsters/jester";
import { makeRotortailPaints } from "./src/game/pinball-knight/render/monsters/rotortail";
// LOAD-BEARING (see foe-sheet.mjs): without the real palette every painter
// renders on the 16-step greyscale fallback and the strip measures nothing.
setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
window.__sb = { paintInArtSpace, crushToGrid, censusCell, paletteRgb, importedPaints,
  painters: { jester: makeJesterPaints, rotortail: makeRotortailPaints } };
`);

  const html = `<!doctype html><meta charset=utf8>
<style>
 body{margin:0;background:#0b0d12;font:12px ui-monospace,Menlo,monospace;color:#8a8272;padding:10px}
 h2{color:#c9bfa4;font-size:13px;letter-spacing:2px;margin:16px 0 6px}
 .arm{display:flex;align-items:center;gap:6px;margin:4px 0}
 .tag{width:290px;text-align:right;padding-right:8px;flex:none}
 .tag b{color:#c9bfa4}
 canvas{display:block;background:#141821;border:1px solid #232833;image-rendering:pixelated;flex:none}
</style>
<div id=root></div>
<script>${js}</script>
<script>
(async () => {
  const { paintInArtSpace, crushToGrid, censusCell, paletteRgb, importedPaints, painters } = window.__sb;
  const GRID = ${grid}, PX = GRID * 2, Z = ${zoom};
  const SHEETS = ${JSON.stringify(sheets)};
  const ARMS = ["painted", "bilinear", "nearest", "box", "dominant", "kcentroid"];
  const pal = paletteRgb();
  const root = document.getElementById("root");

  const decode = (url) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
  });

  // One frame through the production path, exactly like paintFrame does.
  function crushFrame(paint) {
    const buf = document.createElement("canvas");
    buf.width = PX; buf.height = PX;
    const ctx = buf.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, PX, PX);
    paintInArtSpace(ctx, paint, PX);
    return crushToGrid(buf, GRID);
  }

  // The columns: a spread of clips, first + a mid frame of each.
  function pickFrames(clips) {
    const cols = [];
    for (const name of ["idle", "walk", "attack", "stumble", "death"]) {
      const f = clips[name];
      if (!f || !f.length) continue;
      cols.push({ label: name + "0", paint: f[0] });
      if (f.length > 2) cols.push({ label: name + Math.floor(f.length / 2), paint: f[Math.floor(f.length / 2)] });
    }
    return cols.slice(0, 9);
  }

  for (const [key, sheet] of Object.entries(SHEETS)) {
    const h = document.createElement("h2");
    h.textContent = key.toUpperCase() + " — grid " + GRID + ", every arm through the real crush";
    root.appendChild(h);
    const image = await decode(sheet.dataUrl);

    for (const arm of ARMS) {
      const clips = arm === "painted"
        ? painters[key]().S
        : importedPaints([{ manifest: sheet.manifest, image }], arm).S;
      const cols = pickFrames(clips);
      const stats = [];
      const row = document.createElement("div");
      row.className = "arm";
      const tag = document.createElement("div");
      tag.className = "tag";
      row.appendChild(tag);
      for (const c of cols) {
        const small = crushFrame(c.paint);
        const st = censusCell(small.getContext("2d").getImageData(0, 0, GRID, GRID).data, GRID, pal);
        stats.push(st);
        const big = document.createElement("canvas");
        big.width = GRID * Z; big.height = GRID * Z;
        const bctx = big.getContext("2d");
        bctx.imageSmoothingEnabled = false;
        bctx.drawImage(small, 0, 0, GRID * Z, GRID * Z);
        big.title = c.label;
        row.appendChild(big);
      }
      const iso = stats.reduce((a, s) => a + s.isolatedPct, 0) / stats.length;
      const run = stats.reduce((a, s) => a + s.runLen, 0) / stats.length;
      tag.innerHTML = "<b>" + arm + "</b><br>iso " + iso.toFixed(1) + "% · run " + run.toFixed(2);
      root.appendChild(row);
    }
  }
  window.__ready = true;
})().catch((e) => { document.title = "FAILED: " + e.message; console.error(e); });
</script>`;

  const { browser, page } = await open(html, { width: 2100, height: 1200, scale: 1 });
  save(out, await page.screenshot({ fullPage: true }));
  await browser.close();
}

// ══════════════════════════════════════════════════════════════════ GAME MODE
// Host-Chrome CDP recipe from gui-shot.mjs — WSL2 headless has no WebGPU.
async function gameMode() {
  const { chromium } = await import("playwright");
  const url = arg("url", "http://localhost:5301/dungeon?autostart=1&no-intro=1&gpu=webgpu");
  const port = Number(arg("cdp-port", "9345"));
  const kinds = arg("spawn", "jester,rotortail").split(",").map((s) => s.trim()).filter(Boolean);
  const n = Number(arg("n", "5"));
  const out = arg("out", `scratchpad/sandbox/game-${kinds.join("-")}.png`);
  const imported = arg("imported", "1") !== "0";
  const settle = Number(arg("settle", "1800"));

  const alive = async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch { return false; }
  };
  if (!(await alive())) {
    const exe = [
      "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
      "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    ].find((p) => existsSync(p));
    if (!exe) throw new Error("no host Chrome — game mode needs the Windows Chrome for a real WebGPU adapter");
    spawn(exe, [
      "--headless=new", `--remote-debugging-port=${port}`, "--remote-allow-origins=*",
      "--user-data-dir=C:\\Temp\\bdb-sandbox", "--enable-unsafe-webgpu", "--window-size=1600,900",
    ], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 40 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await alive())) throw new Error("host Chrome did not expose CDP");
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.bringToFront(); // backgrounded pages throttle rAF — see gui-shot.mjs

  // The imported-art toggle is read at MODULE LOAD, so it has to be set before
  // the game's scripts run, not after boot.
  await page.addInitScript((on) => {
    try { localStorage.setItem("pinball-knight-imported-art", on ? "1" : "0"); } catch {}
  }, imported);

  page.on("console", (m) => { if (/imported art|pipeline|error/i.test(m.text())) console.log("[page]", m.text()); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__dungeonPlayer?.()?.active === true, null, { timeout: 90_000 });
  await page.waitForTimeout(4000); // idle backfill + applyImportedArt both land in here

  const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
  console.log(`▶ backend=${backend} imported=${imported}`);

  const spawned = await page.evaluate(({ kinds, n }) => {
    if (typeof window.__lab !== "function") return "NO __lab";
    for (let i = 0; i < kinds.length; i++) {
      if (i === 0) window.__lab.only(kinds[i], n);
      else window.__lab.spawn(kinds[i], n);
    }
    return kinds.map((k) => `${k}×${n}`).join(" + ");
  }, { kinds, n });
  console.log(`▶ spawned: ${spawned}`);

  await page.waitForTimeout(settle);
  save(out, await page.screenshot());
  await page.close();
  await browser.close();
}

if (mode === "game") await gameMode();
else await celMode();
