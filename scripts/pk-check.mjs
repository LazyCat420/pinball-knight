#!/usr/bin/env node
/**
 * pk-check — the port's browser verification gate.
 *
 * Loads the wasm build in REAL Windows host Chrome over CDP (SwiftShader
 * cannot run this app — see docs Incidents) and verifies, from outside:
 *   1. zero console errors / page errors (a wasm panic fails the run)
 *   2. the sim ticks (~60 Hz) via the window.__pk debug surface
 *   3. scripted input moves the knight (__pk.x advances under 'd')
 *   4. render FPS over a 3 s rAF sample (reported; budget-gated later)
 *   5. the title intro plays through its phases on a plain load, hands off
 *      to the dungeon, and a click skips it (__pk.intro mirrors the legacy
 *      __dungeonIntroPhase probe)
 * and saves screenshots to .checks/.
 *
 * The sim gates load `?autostart=1` — the harness entry that skips the
 * intro, same contract as the legacy playtest bots.
 *
 * Usage, from the repo root:
 *   node scripts/pk-check.mjs             # trunk build + full check
 *   node scripts/pk-check.mjs --no-build  # reuse web/dist
 *
 * Exit code 0 = every gate passed. Non-zero = the port regressed.
 */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "web/dist");
const PORT = 8791;
const noBuild = process.argv.includes("--no-build");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

function log(ok, msg) {
  console.log(`${ok ? "  ok " : "FAIL "} ${msg}`);
}

async function main() {
  if (!noBuild) {
    console.log("building (trunk)...");
    execSync("trunk build", { cwd: ROOT, stdio: "inherit" });
  }
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error("web/dist/index.html missing — run trunk build");
  }

  const server = createServer(async (req, res) => {
    const path = join(DIST, req.url === "/" ? "index.html" : req.url.split("?")[0]);
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(PORT);

  const { connectRealGpu, closeHostBrowser } = await import(
    "../legacy/scripts/lib/host-chrome.mjs"
  );
  const browser = await connectRealGpu({ log: () => {} });
  const ctx = browser.contexts()[0] ?? (await browser.newContext());
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

  let failed = 0;
  const gate = (ok, msg) => {
    log(ok, msg);
    if (!ok) failed++;
  };

  try {
    await page.goto(`http://localhost:${PORT}/index.html?autostart=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    // Gate 2 precondition: __pk appears (wasm booted, sim resource live).
    const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    let stats = null;
    for (let i = 0; i < 60 && !stats; i++) {
      await page.waitForTimeout(500);
      stats = await pk();
    }
    gate(!!stats, `wasm booted, __pk live ${stats ? `(tick ${stats.tick})` : "(never appeared)"}`);

    if (stats) {
      // Gate: sim ticks at ~60 Hz.
      const t0 = (await pk()).tick;
      await page.waitForTimeout(2000);
      const t1 = (await pk()).tick;
      const rate = (t1 - t0) / 2;
      gate(rate > 45 && rate < 75, `sim ticking (${rate.toFixed(0)} Hz)`);

      // Gate: input moves the knight.
      const x0 = (await pk()).x;
      await page.keyboard.down("d");
      await page.waitForTimeout(1000);
      await page.keyboard.up("d");
      const x1 = (await pk()).x;
      gate(Math.abs(x1 - x0) > 0.5, `input drives movement (Δx=${(x1 - x0).toFixed(2)})`);
    }

    // FPS over a 3 s rAF sample (report always; budget can gate later).
    const fps = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const loop = () => {
            frames++;
            if (performance.now() - start < 3000) requestAnimationFrame(loop);
            else resolve(frames / ((performance.now() - start) / 1000));
          };
          requestAnimationFrame(loop);
        }),
    );
    log(true, `render FPS: ${fps.toFixed(1)}`);

    await mkdir(join(ROOT, ".checks"), { recursive: true });
    const shot = join(ROOT, ".checks", `pk-check-${Date.now()}.png`);
    await page.screenshot({ path: shot });
    console.log("screenshot:", shot);

    // ── Intro gates: a PLAIN load plays the title sequence once ──
    const introPage = await ctx.newPage();
    introPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    introPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await introPage.goto(`http://localhost:${PORT}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const pkIntro = () =>
      introPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    const seen = [];
    let titleShot = false;
    let handoff = null;
    for (let i = 0; i < 140; i++) {
      await introPage.waitForTimeout(250);
      const s = await pkIntro();
      if (!s) continue;
      if (s.intro && seen[seen.length - 1] !== s.intro) seen.push(s.intro);
      if (s.intro === "title" && !titleShot) {
        titleShot = true;
        const tshot = join(ROOT, ".checks", `pk-intro-title-${Date.now()}.png`);
        await introPage.screenshot({ path: tshot });
        console.log("screenshot:", tshot);
      }
      // Finished: the intro handed off and the dungeon sim is live.
      if (s.intro === null && seen.length) {
        handoff = s;
        break;
      }
    }
    gate(seen.length >= 3, `intro plays through phases (${seen.join(" → ") || "never seen"})`);
    gate(titleShot, "intro reached the title card");
    gate(!!handoff && handoff.tick > 0, "intro hands off to a live dungeon sim");
    await introPage.close();

    // ── Skip gate: a click ends the intro immediately ──
    const skipPage = await ctx.newPage();
    skipPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    skipPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await skipPage.goto(`http://localhost:${PORT}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const pkSkip = () =>
      skipPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    let sawIntro = false;
    for (let i = 0; i < 120 && !sawIntro; i++) {
      await skipPage.waitForTimeout(250);
      sawIntro = !!(await pkSkip())?.intro;
    }
    await skipPage.mouse.click(400, 300);
    let skipped = null;
    for (let i = 0; i < 16 && !skipped; i++) {
      await skipPage.waitForTimeout(250);
      const s = await pkSkip();
      if (s && s.intro === null && s.tick > 0) skipped = s;
    }
    gate(sawIntro && !!skipped, "a click skips the intro into the dungeon");
    await skipPage.close();

    // Gate 1: no console/page errors across everything above.
    gate(errors.length === 0, `console clean (${errors.length} errors)`);
    for (const e of errors.slice(0, 5)) console.log("   ", e.slice(0, 200));
  } finally {
    closeHostBrowser();
    server.close();
  }

  console.log(failed === 0 ? "\npk-check: ALL GATES PASSED" : `\npk-check: ${failed} GATE(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("pk-check harness error:", e.message);
  process.exit(2);
});
