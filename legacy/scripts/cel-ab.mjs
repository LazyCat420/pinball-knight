#!/usr/bin/env node
/**
 * CEL-GRADE A/B — the SAME frame, graded three ways, from ONE page.
 *
 * The grade is three shader uniforms, so a variant costs a `__dungeonCel(...)`
 * call and a re-render. That makes this strictly tighter than biome-ab.mjs's
 * two-server recipe: there is no second build, no second maze, no second camera
 * position, and therefore nothing else that could have moved between the shots.
 * Everything that differs between two images here IS the grade.
 *
 *   node scripts/cel-ab.mjs --port 5174 --seed 2 --out /tmp/cel
 *
 * Seed 2 is the BLOODWORKS at depth 1 (the seeds are pinned in biome-ab.mjs):
 * one blood ramp for every piece of masonry, so it is the biome where a grade
 * that crushes or over-saturates has the least anywhere else to hide.
 *
 * CDP launch, WebGPU refusal and the "we are really in a maze" gate are copied
 * from biome-ab.mjs rather than re-derived — a re-implemented harness is how you
 * measure a pipeline the game does not run.
 */
import { chromium } from "playwright";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import sharp from "sharp";

const { values: a } = parseArgs({
  options: {
    port: { type: "string", default: "5174" },
    seed: { type: "string", default: "2" },
    /**
     * "maze" or "hub". The tavern is not optional extra coverage — it is the
     * scene the grade's numbers were ORIGINALLY chosen against (all flat floor
     * and soft lamplight, the worst case for a gradient), and it owns its own
     * pixel pass, so `__dungeonCel` cannot reach it. A curve judged only on a
     * maze would be the same one-room A/B that shipped CEL_STEPS = 8.
     */
    scene: { type: "string", default: "maze" },
    out: { type: "string", default: "/tmp/cel" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9351" },
    boot: { type: "string", default: "16" },
  },
});

/**
 * The variants. `steps, saturation, curve` — the three uniforms.
 *
 * "shipped" is the pre-2026-08-03 look reconstructed through the hook rather
 * than checked out from git: same binary, same frame, only the uniforms move.
 * If it had to be a separate build the comparison would be the old two-server
 * one again, with all of that recipe's ways to differ by accident.
 */
const VARIANTS = [
  { label: "off", args: [0] },
  { label: "shipped", args: [10, 1.35, 1] },
  { label: "curved", args: [10, 1.15, 0.5] },
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
    "--user-data-dir=C:\\Temp\\bdb-cel-ab",
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

/**
 * The two numbers that decide this, both read off the shot itself.
 *
 * CRUSHED — share of pixels at (near) pure black. This is the defect the curve
 * exists to remove; it is not an aesthetic preference, it is detail the art drew
 * that the grade threw away.
 *
 * LOCAL CONTRAST — mean |ΔLuma| between horizontally adjacent pixels, over the
 * FLOOR band only (the middle of the frame, away from the HUD and the void).
 * Grain is high-frequency contrast that the source did not have, so a grade that
 * manufactures it scores HIGH here while the picture gets worse. Reported
 * alongside the crush rather than as a target: neither number is a verdict on
 * its own, which is why the shots are the deliverable and these are the receipt.
 */
async function stats(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const lum = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  const y0 = Math.floor(info.height * 0.2), y1 = Math.floor(info.height * 0.8);
  let crushed = 0, n = 0, dsum = 0, dn = 0, satSum = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch;
      const l = lum(i);
      n++;
      if (l < 0.02) crushed++;
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      if (x + 1 < info.width) {
        dsum += Math.abs(l - lum(i + ch));
        dn++;
      }
    }
  }
  // Distinct colours in the band — "the least amount of colours possible" was
  // the report, so count them rather than argue about it.
  const seen = new Set();
  for (let y = y0; y < y1; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const i = (y * info.width + x) * ch;
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  }
  return {
    crushed: (crushed / n) * 100,
    localContrast: dsum / dn,
    saturation: satSum / n,
    colours: seen.size,
  };
}

mkdirSync(a.out, { recursive: true });
await ensureBrowser();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
await page.bringToFront();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

const url = `http://localhost:${a.port}/dungeon?no-intro=1&gpu=webgpu&seed=${a.seed}`;
console.log(`▶ ${url}`);
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.__dungeonPlayer === "function", null, { timeout: 120_000 });
if (a.scene === "maze") {
  if (!(await page.evaluate(() => window.__dungeonPlayer()?.active === true))) {
    await page.evaluate(() => window.__dungeonStartRun?.());
  }
  await page.waitForFunction(() => window.__dungeonPlayer()?.active === true, null, { timeout: 120_000 });
}
await page.waitForTimeout(Number(a.boot) * 1000);

const backend = await page.evaluate(() => window.__renderBackendResolved ?? "unknown");
if (backend !== "webgpu") {
  console.error(`✘ backend is ${backend}, not webgpu — refusing to judge a grade on the fallback`);
  process.exit(1);
}

const rows = [];
for (const v of VARIANTS) {
  // The tavern owns a SECOND pixel pass with its own uniforms, so the hook has
  // to match the scene — poking the dungeon's would return null and the shot
  // would silently be three copies of the same frame.
  const hook = a.scene === "hub" ? "__tavernCel" : "__dungeonCel";
  const got = await page.evaluate(([h, args]) => window[h]?.(...args), [hook, v.args]);
  if (got == null) throw new Error(`${hook} is not reachable — wrong scene for --scene ${a.scene}?`);
  // The grade only reaches the screen on the next presented frame, and the
  // uniform poke does not itself request one.
  await page.waitForTimeout(600);
  const file = `${a.out}/${v.label}.png`;
  await page.screenshot({ path: file });
  rows.push({ ...v, file, applied: got, ...(await stats(file)) });
  console.log(`  ${v.label.padEnd(8)} ${JSON.stringify(got)}`);
}

console.log("\n" + "variant".padEnd(10) + "crushed%".padStart(10) + "localContr".padStart(12) + "satur".padStart(9) + "colours".padStart(10));
for (const r of rows) {
  console.log(
    r.label.padEnd(10) +
      r.crushed.toFixed(2).padStart(10) +
      r.localContrast.toFixed(4).padStart(12) +
      r.saturation.toFixed(3).padStart(9) +
      String(r.colours).padStart(10),
  );
}
if (errs.length) console.log("\npage errors:\n  " + errs.join("\n  "));
await page.close();
await browser.close();
console.log(`\n▶ shots in ${a.out}`);
