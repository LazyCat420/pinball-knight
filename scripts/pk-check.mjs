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
 * and saves a screenshot to .checks/.
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
    await page.goto(`http://localhost:${PORT}/index.html`, {
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

    // Gate 1: no console/page errors across everything above.
    gate(errors.length === 0, `console clean (${errors.length} errors)`);
    for (const e of errors.slice(0, 5)) console.log("   ", e.slice(0, 200));

    await mkdir(join(ROOT, ".checks"), { recursive: true });
    const shot = join(ROOT, ".checks", `pk-check-${Date.now()}.png`);
    await page.screenshot({ path: shot });
    console.log("screenshot:", shot);
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
