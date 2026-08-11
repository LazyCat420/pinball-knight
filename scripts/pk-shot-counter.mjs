#!/usr/bin/env node
/**
 * pk-shot-counter — walk to a tavern station and photograph its counter.
 *
 * "The Manage Loadout UI is still not showing up" is not answerable from a
 * test: the rules have unit tests and the screen has layout tests, and BOTH
 * were green while the room showed a placeholder that said the counter did not
 * exist yet. The only honest answer is the picture, so this takes it.
 *
 *   node scripts/pk-shot-counter.mjs                 # trunk build + armory
 *   node scripts/pk-shot-counter.mjs --no-build
 *   node scripts/pk-shot-counter.mjs --station table
 *
 * ── WALKING IS THE HARD PART, AND IT IS NOT INCIDENTAL ─────────────────────
 * WASD is SCREEN-relative in an isometric room, the central pinball table walls
 * off the spine, and a CDP key-hold crosses ground slowly. So this is a CLOSED
 * LOOP: read the pose from `__pk.tavern`, hold the key that reduces the larger
 * axis error, re-read, repeat. An open-loop sequence of holds is what
 * `pk-check`'s own notes warn about — it arrives one row off and walks into a
 * wall, and the failure reads as "the counter is broken".
 *
 * ⚠️ RELEASE EVERY MOVEMENT KEY BETWEEN LEGS. CDP drops keyups; a phantom key
 * down makes every later leg walk diagonally.
 */
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const { values: a } = parseArgs({
  options: {
    "no-build": { type: "boolean", default: false },
    station: { type: "string", default: "armory" },
    out: { type: "string", default: join(ROOT, ".checks") },
    port: { type: "string", default: "8795" },
    "cdp-port": { type: "string", default: process.env.BDB_CDP_PORT ?? "9333" },
  },
});

const VIEW_W = 1600;
const VIEW_H = 900;
const PORT = Number(a.port);

/** Stand-here positions, from `pk_core::tavern::layout::STATIONS`. */
const STATIONS = {
  table: { x: 0.0, z: 0.0, label: "Review Run" },
  armory: { x: -4.8, z: 2.8, label: "Manage Loadout" },
  cards: { x: 4.8, z: 2.8, label: "Cards" },
  gambler: { x: 2.2, z: 5.5, label: "Risk Gold" },
};

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".json": "application/json",
};

const log = (m) => console.log(m);

async function main() {
  const target = STATIONS[a.station];
  if (!target) throw new Error(`--station wants one of ${Object.keys(STATIONS).join(", ")}`);
  await mkdir(a.out, { recursive: true });

  if (!a["no-build"]) {
    log("building (trunk)...");
    execSync("trunk build", { cwd: ROOT, stdio: "inherit" });
  }
  if (!existsSync(join(ROOT, "web/dist/index.html"))) {
    throw new Error("web/dist/index.html missing — run trunk build");
  }
  const server = createServer(async (req, res) => {
    const p = join(ROOT, "web/dist", req.url === "/" ? "index.html" : req.url.split("?")[0]);
    try {
      const body = await readFile(p);
      res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(PORT);

  const { connectRealGpu, closeHostBrowser } = await import("../legacy/scripts/lib/host-chrome.mjs");
  const browser = await connectRealGpu({ port: Number(a["cdp-port"]) });
  if (!browser) {
    server.close();
    throw new Error("no real-GPU host browser — SwiftShader cannot run the Bevy wasm app at all");
  }
  const ctx = await browser.newContext({ viewport: { width: VIEW_W, height: VIEW_H } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  try {
    await page.goto(`http://localhost:${PORT}/index.html?tavern=1&mute=1`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.bringToFront();

    const pk = () => page.evaluate(() => (window.__pk ? JSON.parse(window.__pk) : null));
    const pose = async () => (await pk())?.tavern ?? null;
    for (let i = 0; i < 240 && !(await pose()); i++) await page.waitForTimeout(500);
    if (!(await pose())) throw new Error("the tavern never booted (__pk.tavern stayed null)");
    await page.waitForTimeout(2500); // atlases and the room's first paint

    const release = async () => {
      for (const k of ["w", "a", "s", "d"]) await page.keyboard.up(k).catch(() => {});
    };
    // Closed-loop walk. Screen-relative: 'a' lowers x, 'w' lowers z.
    let p = await pose();
    log(`start   x=${p.x.toFixed(2)} z=${p.z.toFixed(2)}  →  ${a.station} (${target.x}, ${target.z})`);
    for (let step = 0; step < 60; step++) {
      p = await pose();
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      if (Math.hypot(dx, dz) < 0.9) break;
      const key = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? "a" : "d") : dz < 0 ? "w" : "s";
      await page.keyboard.down(key);
      await page.waitForTimeout(260);
      await release();
      await page.waitForTimeout(90);
    }
    p = await pose();
    const dist = Math.hypot(target.x - p.x, target.z - p.z);
    log(`arrived x=${p.x.toFixed(2)} z=${p.z.toFixed(2)}  dist=${dist.toFixed(2)}  focus=${p.focus}`);
    if (p.focus !== a.station) {
      log(`  ⚠ focus is "${p.focus}", not "${a.station}" — the prompt belongs to another station`);
    }

    await page.keyboard.press("e");
    await page.waitForTimeout(1200);
    const after = await pose();
    const gui = (await pk())?.gui ?? null;
    log(`panel=${after?.panel}  gui.open=${gui?.open}  painted=${gui?.painted}`);

    const shot = join(a.out, `tavern-counter-${a.station}.png`);
    await page.screenshot({ path: shot });
    log(`screenshot: ${shot}`);
    if (!after?.panel) {
      log("  ⚠ NO PANEL IS OPEN — the counter did not answer the E press");
    }
    if (errors.length) {
      log(`console errors (${errors.length}):`);
      for (const e of errors.slice(0, 5)) log(`   ${e.slice(0, 200)}`);
    }
  } finally {
    await ctx.close().catch(() => {});
    closeHostBrowser();
    server.close();
  }
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
