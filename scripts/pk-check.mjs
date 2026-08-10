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
 *      to the TAVERN hub, and a click skips it (__pk.intro mirrors the legacy
 *      __dungeonIntroPhase probe)
 * and saves screenshots to .checks/.
 *
 * Boot is hub-first, so `?autostart=1` now lands in the tavern. The sim and
 * input gates need a floor to measure, so they ask for one explicitly with
 * `?dungeon=1` — the dev hatch. Every page carries `mute=1`: the harness
 * drives the real host machine and must not make noise.
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
    // `autostart=1` alone now lands in the tavern hub (the boot flow is
    // hub-first), so the sim/input gates below ask for a floor explicitly.
    // `mute=1` keeps the harness silent on the host box.
    await page.goto(`http://localhost:${PORT}/index.html?autostart=1&dungeon=1&mute=1`, {
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
    await introPage.goto(`http://localhost:${PORT}/index.html?mute=1`, {
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
      // Finished: the intro handed off and the hub is live.
      if (s.intro === null && seen.length) {
        handoff = s;
        break;
      }
    }
    gate(seen.length >= 3, `intro plays through phases (${seen.join(" → ") || "never seen"})`);
    gate(titleShot, "intro reached the title card");
    // Hub-first: the title sequence hands you the TAVERN, not a floor. `tick`
    // keeps advancing without a sim (publish_stats synthesises it), so
    // liveness alone would pass over a black screen — the probe shape is what
    // proves a room actually built.
    gate(
      !!handoff && handoff.tavern !== null && handoff.tick > 0,
      "intro hands off to the tavern hub",
    );
    gate(
      typeof handoff?.tavern?.x === "number",
      `tavern probe carries a pose (${handoff?.tavern ? `x ${handoff.tavern.x.toFixed(2)}` : "no probe"})`,
    );
    await introPage.close();

    // ── Skip gate: a click ends the intro immediately ──
    const skipPage = await ctx.newPage();
    skipPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    skipPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await skipPage.goto(`http://localhost:${PORT}/index.html?mute=1`, {
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
      if (s && s.intro === null && s.tavern !== null) skipped = s;
    }
    gate(sawIntro && !!skipped, "a click skips the intro into the tavern");
    await skipPage.close();

    // ── Tavern gates: ?tavern=1 boots the walkable hub (P6) ──
    // Drives the room from outside via __pk.tavern (the legacy __tavernProbe
    // surface): movement, station focus, the summary panel, and the DESCEND
    // hand-off into a fresh dungeon floor.
    const tavPage = await ctx.newPage();
    tavPage.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    tavPage.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
    await tavPage.goto(`http://localhost:${PORT}/index.html?tavern=1&mute=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const pkTav = () => tavPage.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    let tav = null;
    for (let i = 0; i < 60 && !tav; i++) {
      await tavPage.waitForTimeout(500);
      tav = (await pkTav())?.tavern ?? null;
    }
    gate(!!tav, `tavern boots via ?tavern=1 ${tav ? `(spawn ${tav.x.toFixed(1)}, ${tav.z.toFixed(1)})` : "(probe never appeared)"}`);

    if (tav) {
      const hold = async (keys, ms) => {
        for (const k of keys) await tavPage.keyboard.down(k);
        await tavPage.waitForTimeout(ms);
        // Release EVERY movement key, not just the ones this hold pressed: a
        // dropped keyup under CDP leaves a phantom key held and every later
        // leg walks diagonally — observed as the closed-loop walk sailing
        // back into the table's radius.
        for (const k of ["w", "a", "s", "d"]) await tavPage.keyboard.up(k);
        await tavPage.waitForTimeout(60);
      };
      // Walk due north (screen up-right) from the spawn: crosses the room's
      // spine and stops against the central table — movement + collision.
      const z0 = tav.z;
      await hold(["w", "d"], 1100);
      const afterWalk = (await pkTav()).tavern;
      gate(afterWalk.z < z0 - 2, `tavern input drives movement (Δz=${(afterWalk.z - z0).toFixed(2)})`);
      gate(afterWalk.focus === "table", `station focus fires at the central table (focus=${afterWalk.focus})`);

      // The run summary: E opens it (movement freezes), Escape closes it.
      // Poll rather than single-read: the probe publishes on a frame cadence.
      const pollTav = async (done, ms = 2500) => {
        const t0 = Date.now();
        let p = null;
        while (Date.now() - t0 < ms) {
          p = (await pkTav())?.tavern ?? null;
          if (p && done(p)) return p;
          await tavPage.waitForTimeout(150);
        }
        return p;
      };
      await tavPage.keyboard.press("e");
      const withPanel = await pollTav((p) => p.panel === true);
      gate(withPanel?.panel === true, "E opens the run summary panel");
      await tavPage.keyboard.press("Escape");
      const noPanel = await pollTav((p) => p.panel === false);
      gate(noPanel?.panel === false, "Escape closes the panel");

      // Route to the DESCEND board: west along the table's flank, north up
      // the west lane, then east into the corridor between the board and the
      // table. CLOSED-LOOP on the probe's pose — key-hold timing under CDP is
      // not tick-exact and the post-release slide drifts, so each leg walks
      // until the coordinate says it arrived. (Key mapping: due north = W+D,
      // east = S+D, west = W+A on the 45° screen basis.)
      const walkUntil = async (keys, done, maxSteps = 24) => {
        for (let i = 0; i < maxSteps; i++) {
          const p = (await pkTav()).tavern;
          if (!p || done(p)) return p;
          await hold(keys, 260);
        }
        return (await pkTav()).tavern;
      };
      await walkUntil(["w", "a"], (p) => p.x <= -4.4); // west, clear of the table
      await walkUntil(["w", "d"], (p) => p.z <= -4.4); // north up the west lane
      let atBoard = await walkUntil(["s", "d"], (p) => p.focus === "board" || p.x > 1.4); // east into the corridor
      if (atBoard?.focus !== "board") {
        // Overshot east past the radius — walk back west until it catches.
        atBoard = await walkUntil(["w", "a"], (p) => p.focus === "board", 10);
      }
      gate(atBoard?.focus === "board", `reached the DESCEND board on foot (focus=${atBoard?.focus})`);

      const tavShot = join(ROOT, ".checks", `pk-tavern-${Date.now()}.png`);
      await tavPage.screenshot({ path: tavShot });
      console.log("screenshot:", tavShot);

      // The plunger: E on the board tears the tavern down and builds a
      // fresh dungeon floor — the real hand-off.
      await tavPage.keyboard.press("e");
      let descended = null;
      for (let i = 0; i < 20 && !descended; i++) {
        await tavPage.waitForTimeout(250);
        const s = await pkTav();
        if (s && s.tavern === null && s.x !== undefined) descended = s;
      }
      gate(!!descended, "DESCEND hands off to a live dungeon sim");
    }
    await tavPage.close();

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
